import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { CURATED_TEST_PRODUCTS } from './src/data/catalog';
import { generateInteractionPlan, MissingGeminiKeyError } from './src/lib/geminiPlanner';
import {
  parseShopifyProductItem,
  parseShopifyProductJson,
  type ShopifyRawProductNode,
  type ShopifyRawProductPayload,
} from './src/lib/planLogic';
import { renderProductInRoomScene, type SceneRenderRequest } from './src/lib/sceneRenderer';
import type { ProductData } from './src/types/commerce';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

const DEFAULT_LIVE_SHOPIFY_URLS = [
  'https://www.schoolhouse.com/products/isaac-desk-lamp',
  'https://floydhome.com/products/the-gere-easy-chair-chalk-granite',
  'https://www.schoolhouse.com/products/atwood-pendant',
];

let liveCatalogCache: { expiresAt: number; products: ProductData[]; mode: string } | null = null;

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(lower)) {
    return true;
  }
  return false;
}

function classifyShopifyUrl(rawUrl: string): {
  mode: 'single_product' | 'store_collection';
  jsonUrl: string;
  canonicalUrl: string;
  origin: string;
} {
  let parsed: URL;
  try {
    const normalized = /^https?:\/\//i.test(rawUrl.trim())
      ? rawUrl.trim()
      : `https://${rawUrl.trim()}`;
    parsed = new URL(normalized);
  } catch {
    throw new Error('Please enter a valid Shopify store or product URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP/HTTPS Shopify storefront URLs are supported.');
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('Private or local network URLs are not permitted.');
  }

  const productMatch = parsed.pathname.match(/\/products\/([^/?#]+)/i);
  if (productMatch && productMatch[1]) {
    const handle = productMatch[1].replace(/\.json$/i, '');
    const canonicalUrl = `${parsed.origin}/products/${handle}`;
    return {
      mode: 'single_product',
      jsonUrl: `${canonicalUrl}.json`,
      canonicalUrl,
      origin: parsed.origin,
    };
  }

  const collectionMatch = parsed.pathname.match(/\/collections\/([^/?#]+)/i);
  if (collectionMatch && collectionMatch[1]) {
    const colHandle = collectionMatch[1];
    return {
      mode: 'store_collection',
      jsonUrl: `${parsed.origin}/collections/${colHandle}/products.json?limit=6`,
      canonicalUrl: `${parsed.origin}/collections/${colHandle}`,
      origin: parsed.origin,
    };
  }

  return {
    mode: 'store_collection',
    jsonUrl: `${parsed.origin}/products.json?limit=6`,
    canonicalUrl: parsed.origin,
    origin: parsed.origin,
  };
}

async function fetchSingleShopifyProduct(canonicalUrl: string): Promise<ProductData> {
  const jsonUrl = `${canonicalUrl.replace(/\.json$/i, '')}.json`;
  const response = await fetch(jsonUrl, {
    signal: AbortSignal.timeout(6500),
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Adaptive3DCommerce/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Shopify API returned HTTP ${response.status} for ${jsonUrl}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Shopify endpoint did not return JSON.');
  }
  const payload = (await response.json()) as ShopifyRawProductPayload;
  return parseShopifyProductJson(payload, canonicalUrl);
}

async function fetchConfiguredStorefrontApi(
  storeDomain: string,
  storefrontToken: string,
): Promise<ProductData[]> {
  const cleanDomain = storeDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const query = `{
    products(first: 6) {
      edges {
        node {
          id
          handle
          title
          vendor
          productType
          description
          images(first: 6) {
            edges {
              node {
                url
              }
            }
          }
          variants(first: 6) {
            edges {
              node {
                id
                title
                price {
                  amount
                  currencyCode
                }
                image {
                  url
                }
              }
            }
          }
        }
      }
    }
  }`;

  const response = await fetch(`https://${cleanDomain}/api/2025-01/graphql.json`, {
    method: 'POST',
    signal: AbortSignal.timeout(7000),
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': storefrontToken,
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Shopify Storefront GraphQL API responded with HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    data?: {
      products?: {
        edges?: Array<{
          node: {
            id: string;
            handle: string;
            title: string;
            vendor: string;
            productType: string;
            description: string;
            images?: { edges?: Array<{ node: { url: string } }> };
            variants?: {
              edges?: Array<{
                node: {
                  id: string;
                  title: string;
                  price?: { amount: string; currencyCode: string };
                  image?: { url: string } | null;
                };
              }>;
            };
          };
        }>;
      };
    };
  };

  const edges = json.data?.products?.edges ?? [];
  return edges.map(({ node }) => {
    const rawNode: ShopifyRawProductNode = {
      id: node.id,
      handle: node.handle,
      title: node.title,
      vendor: node.vendor,
      product_type: node.productType,
      body_html: node.description,
      images: (node.images?.edges ?? []).map((e) => ({ src: e.node.url })),
      variants: (node.variants?.edges ?? []).map((v) => ({
        id: v.node.id,
        title: v.node.title,
        price: v.node.price?.amount ?? '0.00',
        featured_image: v.node.image?.url ? { src: v.node.image.url } : null,
      })),
    };
    return parseShopifyProductItem(rawNode, `https://${cleanDomain}/products/${node.handle}`);
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      shopifyStorefrontConfigured: Boolean(
        process.env.SHOPIFY_STORE_DOMAIN?.trim() &&
          process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim(),
      ),
    });
  });

  // Live Shopify Catalog API Connector
  app.get('/api/shopify/catalog', async (_req, res) => {
    if (liveCatalogCache && Date.now() < liveCatalogCache.expiresAt) {
      res.json({
        products: liveCatalogCache.products,
        connectionMode: liveCatalogCache.mode,
      });
      return;
    }

    const customDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
    const customToken = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim();

    if (customDomain && customToken) {
      try {
        const products = await fetchConfiguredStorefrontApi(customDomain, customToken);
        if (products.length > 0) {
          liveCatalogCache = {
            expiresAt: Date.now() + 5 * 60 * 1000,
            products,
            mode: 'storefront_graphql',
          };
          res.json({ products, connectionMode: 'storefront_graphql' });
          return;
        }
      } catch (err) {
        console.warn('Configured Storefront GraphQL fetch failed, falling back:', err);
      }
    }

    const settled = await Promise.allSettled(
      DEFAULT_LIVE_SHOPIFY_URLS.map((url) => fetchSingleShopifyProduct(url)),
    );

    const products: ProductData[] = settled.map((result, idx) =>
      result.status === 'fulfilled' ? result.value : CURATED_TEST_PRODUCTS[idx],
    );

    const anyLive = settled.some((r) => r.status === 'fulfilled');
    const connectionMode = anyLive ? 'shopify_public_json' : 'fallback_fixture';

    liveCatalogCache = {
      expiresAt: Date.now() + 5 * 60 * 1000,
      products,
      mode: connectionMode,
    };

    res.json({ products, connectionMode });
  });

  app.post('/api/shopify/fetch', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    if (!rawUrl.trim()) {
      res.status(400).json({ error: 'Please provide a Shopify store or product URL.' });
      return;
    }

    let endpoint: ReturnType<typeof classifyShopifyUrl>;
    try {
      endpoint = classifyShopifyUrl(rawUrl);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid Shopify URL.' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const upstream = await fetch(endpoint.jsonUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Adaptive3DCommerce/1.0',
        },
      });

      if (!upstream.ok) {
        res.status(502).json({
          error: `Shopify API responded with HTTP ${upstream.status}. Public JSON may be disabled on this store.`,
        });
        return;
      }

      const contentType = upstream.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        res.status(502).json({
          error: 'URL did not return Shopify product JSON. Try a Shopify store or /products/<handle> URL.',
        });
        return;
      }

      if (endpoint.mode === 'single_product') {
        const payload = (await upstream.json()) as ShopifyRawProductPayload;
        const product = parseShopifyProductJson(payload, endpoint.canonicalUrl);
        res.json({ product, catalogProducts: [product] });
        return;
      }

      const payload = (await upstream.json()) as { products?: ShopifyRawProductNode[] };
      const rawItems = Array.isArray(payload.products) ? payload.products : [];
      if (rawItems.length === 0) {
        res.status(502).json({ error: 'No public products found in that Shopify store catalog.' });
        return;
      }

      const parsedProducts = rawItems.slice(0, 6).map((item) =>
        parseShopifyProductItem(
          item,
          `${endpoint.origin}/products/${item.handle ?? 'item'}`,
        ),
      );
      res.json({
        product: parsedProducts[0],
        catalogProducts: parsedProducts,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? 'Timed out waiting for Shopify storefront API response (8s).'
          : err instanceof Error
            ? err.message
            : 'Unable to fetch Shopify product data.';
      res.status(502).json({ error: message });
    } finally {
      clearTimeout(timeout);
    }
  });

  app.post('/api/analyze', async (req, res) => {
    const product = req.body?.product as ProductData | undefined;
    if (!product || typeof product.title !== 'string' || !product.title.trim()) {
      res.status(400).json({ error: 'Valid product data is required for AI interaction planning.' });
      return;
    }

    try {
      const plan = await generateInteractionPlan(product);
      res.json({ plan });
    } catch (err) {
      if (err instanceof MissingGeminiKeyError) {
        res.status(503).json({
          code: 'MISSING_API_KEY',
          error:
            'Live Gemini analysis requires GEMINI_API_KEY on the server. You can load a verified snapshot plan below to preview the 3D template.',
        });
        return;
      }

      const message = err instanceof Error ? err.message : 'Failed to generate interaction plan.';
      res.status(502).json({
        code: 'UPSTREAM_GEMINI_ERROR',
        error: message,
      });
    }
  });

  app.post('/api/scene/render', async (req, res) => {
    const body = req.body as Partial<SceneRenderRequest> | undefined;
    if (!body || !body.productTitle || !body.roomImageInput || !body.placementHint) {
      res.status(400).json({
        error: 'Product details, room photograph, and placement selection are required.',
      });
      return;
    }

    try {
      const result = await renderProductInRoomScene({
        productTitle: String(body.productTitle),
        productVendor: String(body.productVendor || 'Shopify Merchant'),
        productType: String(body.productType || 'Home & Lighting'),
        productDescription: body.productDescription ? String(body.productDescription) : undefined,
        dimensions: body.dimensions,
        variantLabel: String(body.variantLabel || 'Standard Finish'),
        variantHex: String(body.variantHex || '#3a3e42'),
        productImageUrl: body.productImageUrl ? String(body.productImageUrl) : undefined,
        roomImageInput: String(body.roomImageInput),
        placementHint: String(body.placementHint),
        lightingMood: body.lightingMood,
        customPromptNote: body.customPromptNote ? String(body.customPromptNote) : undefined,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof MissingGeminiKeyError) {
        res.status(503).json({
          code: 'MISSING_API_KEY',
          error: 'Room scene rendering requires GEMINI_API_KEY configured on the server.',
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to render product in room photo.';
      const status =
        /RESOURCE_EXHAUSTED|429|PERMISSION_DENIED|403|billing|paid/i.test(message) ? 402 : 502;
      res.status(status).json({
        code: status === 402 ? 'PAID_KEY_REQUIRED' : 'SCENE_RENDER_ERROR',
        error: message,
      });
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Adaptive 3D Commerce server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
