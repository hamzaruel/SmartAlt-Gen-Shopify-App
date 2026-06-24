// Shopify Admin GraphQL helpers.
// Auth = the stored offline access token (X-Shopify-Access-Token header).
//
// Unified image item shape returned by getAllImages():
//   { source: 'product' | 'file' | 'article' | 'collection',
//     id,         // GID used to embed the alt back
//     url, alt, title, type, position,
//     width, height,        // pixels (for the preview)
//     adminUrl,             // deep link into the Shopify admin
//     onlineUrl }           // public storefront url (nullable)

const API_VERSION = '2025-01';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function adminGraphQL(shop, token, query, variables = {}, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      // HTTP-level rate limit → wait and retry.
      if (res.status === 429 && attempt < retries) {
        await sleep(2000);
        continue;
      }
      throw new Error(`Admin GraphQL ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    if (json.errors) {
      // Cost-limit throttling → back off based on the bucket, then retry.
      if (/throttl/i.test(JSON.stringify(json.errors)) && attempt < retries) {
        const ts = json.extensions?.cost?.throttleStatus;
        let waitMs = 2000;
        if (ts?.restoreRate) {
          const need = (json.extensions.cost.requestedQueryCost || 0) - (ts.currentlyAvailable || 0);
          waitMs = Math.min(5000, Math.max(1000, Math.ceil((need / ts.restoreRate) * 1000)));
        }
        await sleep(waitMs);
        continue;
      }
      throw new Error(`Admin GraphQL errors: ${JSON.stringify(json.errors).slice(0, 200)}`);
    }
    return json.data;
  }
}

const numericId = (gid) => (gid || '').split('/').pop();
const adminLink = (shop, path) => `https://${shop}/admin/${path}`; // legacy paths redirect to admin.shopify.com

function deriveTitleFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    let name = decodeURIComponent(path.split('/').pop() || '');
    name = name.replace(/\.[a-z0-9]+$/i, '');
    name = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    name = name.replace(/\b\d+x\b/gi, '').trim();
    if (!name) return 'Image';
    return name.replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return 'Image';
  }
}

// ---------------------- GraphQL queries (one page each) ----------------------
const PRODUCTS_QUERY = `
  query ScanProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        productType
        vendor
        updatedAt
        onlineStoreUrl
        media(first: 50) {
          nodes { ... on MediaImage { id alt image { url width height } } }
        }
      }
    }
  }
`;

const FILES_QUERY = `
  query ScanFiles($cursor: String) {
    files(first: 50, after: $cursor, query: "media_type:IMAGE") {
      pageInfo { hasNextPage endCursor }
      nodes { ... on MediaImage { id alt updatedAt image { url width height } } }
    }
  }
`;

const ARTICLES_QUERY = `
  query ScanArticles($cursor: String) {
    articles(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        updatedAt
        image { url width height altText }
        blog { handle }
      }
    }
  }
`;

const COLLECTIONS_QUERY = `
  query ScanCollections($cursor: String) {
    collections(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id title handle updatedAt image { url width height altText } }
    }
  }
`;

// ---------------------- node → unified item mappers ----------------------
function mapProductNodes(shop, nodes) {
  const out = [];
  for (const product of nodes) {
    let position = 0;
    for (const media of product.media.nodes) {
      if (!media?.id || !media?.image?.url) continue;
      position += 1;
      out.push({
        source: 'product',
        id: media.id,
        url: media.image.url,
        alt: media.alt ?? null,
        title: product.title,
        type: product.productType || null,
        vendor: product.vendor || null,
        position,
        width: media.image.width ?? null,
        height: media.image.height ?? null,
        updatedAt: product.updatedAt ?? null,
        adminUrl: adminLink(shop, `products/${numericId(product.id)}`),
        onlineUrl: product.onlineStoreUrl || null,
      });
    }
  }
  return out;
}

function mapFileNodes(shop, nodes) {
  const out = [];
  for (const node of nodes) {
    if (!node?.id || !node?.image?.url) continue;
    out.push({
      source: 'file',
      id: node.id,
      url: node.image.url,
      alt: node.alt ?? null,
      title: deriveTitleFromUrl(node.image.url),
      type: null,
      position: 1,
      width: node.image.width ?? null,
      height: node.image.height ?? null,
      updatedAt: node.updatedAt ?? null,
      adminUrl: adminLink(shop, 'content/files'),
      onlineUrl: node.image.url,
    });
  }
  return out;
}

function mapArticleNodes(shop, nodes) {
  const out = [];
  for (const article of nodes) {
    if (!article?.id || !article?.image?.url) continue;
    out.push({
      source: 'article',
      id: article.id,
      url: article.image.url,
      alt: article.image.altText ?? null,
      title: article.title,
      type: null,
      position: 1,
      width: article.image.width ?? null,
      height: article.image.height ?? null,
      updatedAt: article.updatedAt ?? null,
      adminUrl: adminLink(shop, `articles/${numericId(article.id)}`),
      onlineUrl: article.blog?.handle && article.handle
        ? `https://${shop}/blogs/${article.blog.handle}/${article.handle}`
        : null,
    });
  }
  return out;
}

function mapCollectionNodes(shop, nodes) {
  const out = [];
  for (const c of nodes) {
    if (!c?.id || !c?.image?.url) continue;
    out.push({
      source: 'collection',
      id: c.id,
      url: c.image.url,
      alt: c.image.altText ?? null,
      title: c.title,
      type: null,
      position: 1,
      width: c.image.width ?? null,
      height: c.image.height ?? null,
      updatedAt: c.updatedAt ?? null,
      adminUrl: adminLink(shop, `collections/${numericId(c.id)}`),
      onlineUrl: c.handle ? `https://${shop}/collections/${c.handle}` : null,
    });
  }
  return out;
}

// Per-source config: query, connection field, mapper, and whether a hard error
// should abort the scan (products) or just skip that source (files/articles/collections,
// e.g. when a scope is missing).
const SOURCES = {
  product:    { query: PRODUCTS_QUERY,    field: 'products',    map: mapProductNodes,    optional: false },
  file:       { query: FILES_QUERY,       field: 'files',       map: mapFileNodes,       optional: true },
  article:    { query: ARTICLES_QUERY,    field: 'articles',    map: mapArticleNodes,    optional: true },
  collection: { query: COLLECTIONS_QUERY, field: 'collections', map: mapCollectionNodes, optional: true },
};
const SOURCE_ORDER = ['product', 'file', 'article', 'collection'];
// `allowed` (optional array) limits which sources are scanned; undefined = all.
const isAllowed = (s, allowed) => !allowed || allowed.includes(s);
const firstAllowed = (allowed) => SOURCE_ORDER.find((s) => isAllowed(s, allowed)) || null;
const nextAllowed = (s, allowed) => {
  for (let i = SOURCE_ORDER.indexOf(s) + 1; i < SOURCE_ORDER.length; i++) {
    if (isAllowed(SOURCE_ORDER[i], allowed)) return SOURCE_ORDER[i];
  }
  return null;
};

// Fetch ONE page of a source. Returns { items, hasNextPage, endCursor }, or null
// if an optional source errored (caller should skip it).
async function fetchSourcePage(shop, token, source, cursor) {
  const cfg = SOURCES[source];
  try {
    const data = await adminGraphQL(shop, token, cfg.query, { cursor });
    const conn = data?.[cfg.field];
    if (!conn) return { items: [], hasNextPage: false, endCursor: null };
    return {
      items: cfg.map(shop, conn.nodes),
      hasNextPage: conn.pageInfo.hasNextPage,
      endCursor: conn.pageInfo.endCursor,
    };
  } catch (e) {
    if (cfg.optional) {
      console.warn(`⚠️ ${source} scan skipped:`, e.message);
      return null; // skip this source, keep scanning the rest
    }
    throw e; // products error → surface as a real failure
  }
}

// Soft targets so each packet stays well under the serverless timeout while
// still doing meaningful work per round-trip.
const PACKET_TARGET = 500;     // try to collect at least this many items per call
const MAX_PAGES_PER_CALL = 12; // hard cap on pages per call (safety)

// Scan ONE packet starting from `state` ({ source, cursor } | null = start).
// Returns { items, next } where `next` is the pointer for the FOLLOWING call,
// or null when the whole store has been scanned. Each call does a bounded amount
// of work (≤ MAX_PAGES_PER_CALL pages / one source) so it never times out.
export async function scanPacket(shop, token, state, allowedSources) {
  let source = state?.source || firstAllowed(allowedSources);
  let cursor = state?.cursor ?? null;

  while (source) {
    const items = [];
    let pages = 0;
    let hasNextPage = false;
    let endCursor = null;
    let skipped = false;

    while (pages < MAX_PAGES_PER_CALL && items.length < PACKET_TARGET) {
      const page = await fetchSourcePage(shop, token, source, cursor);
      if (page === null) { skipped = true; break; } // optional source errored
      items.push(...page.items);
      pages += 1;
      hasNextPage = page.hasNextPage;
      endCursor = page.endCursor;
      cursor = page.endCursor;
      if (!hasNextPage) break;
    }

    // optional source threw before yielding anything → drop to the next allowed source
    if (skipped && items.length === 0) {
      source = nextAllowed(source, allowedSources);
      cursor = null;
      continue;
    }

    const ns = nextAllowed(source, allowedSources);
    const next = hasNextPage
      ? { source, cursor: endCursor }
      : (ns ? { source: ns, cursor: null } : null);
    return { items, next };
  }

  return { items: [], next: null };
}

// Fetch every alt-bearing image across the store (all sources), looping the
// packet scanner to completion. Kept for callers that want the full list at once.
export async function getAllImages(shop, token, maxPackets = 500) {
  const out = [];
  let state = null;
  let n = 0;
  do {
    const { items, next } = await scanPacket(shop, token, state);
    out.push(...items);
    state = next;
    n += 1;
  } while (state && n < maxPackets);
  return out;
}

// ---------------------- EMBED (write alt back to Shopify) ----------------------
const FILE_UPDATE = `
  mutation FileUpdate($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files { ... on MediaImage { id alt } }
      userErrors { field message }
    }
  }
`;

const ARTICLE_UPDATE = `
  mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article { id image { altText } }
      userErrors { field message }
    }
  }
`;

const COLLECTION_UPDATE = `
  mutation CollectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id image { altText } }
      userErrors { field message }
    }
  }
`;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// items: [{ source, id, url, alt }] — `alt` is the text to embed.
export async function embedAlts(shop, token, items) {
  let applied = 0;
  const errors = [];

  // product + file go through fileUpdate (MediaImage), batched.
  const mediaItems = items.filter((i) => i.source === 'product' || i.source === 'file');
  for (const batch of chunk(mediaItems, 25)) {
    const files = batch.map((i) => ({ id: i.id, alt: i.alt }));
    try {
      const data = await adminGraphQL(shop, token, FILE_UPDATE, { files });
      const userErrors = data?.fileUpdate?.userErrors ?? [];
      if (userErrors.length) errors.push(...userErrors.map((e) => e.message));
      applied += batch.length - userErrors.length;
    } catch (e) {
      errors.push(e.message || 'fileUpdate failed');
    }
  }

  // articles update one at a time (articleUpdate needs the existing image url).
  for (const item of items.filter((i) => i.source === 'article')) {
    try {
      const data = await adminGraphQL(shop, token, ARTICLE_UPDATE, {
        id: item.id,
        article: { image: { altText: item.alt, url: item.url } },
      });
      const userErrors = data?.articleUpdate?.userErrors ?? [];
      if (userErrors.length) errors.push(...userErrors.map((e) => e.message));
      else applied += 1;
    } catch (e) {
      errors.push(e.message || 'articleUpdate failed');
    }
  }

  // collections update one at a time (collectionUpdate, re-passing the image src).
  for (const item of items.filter((i) => i.source === 'collection')) {
    try {
      const data = await adminGraphQL(shop, token, COLLECTION_UPDATE, {
        input: { id: item.id, image: { altText: item.alt, src: item.url } },
      });
      const userErrors = data?.collectionUpdate?.userErrors ?? [];
      if (userErrors.length) errors.push(...userErrors.map((e) => e.message));
      else applied += 1;
    } catch (e) {
      errors.push(e.message || 'collectionUpdate failed');
    }
  }

  return { applied, errors };
}
