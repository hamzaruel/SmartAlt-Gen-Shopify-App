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

// ---------------------- PRODUCTS (gallery media) ----------------------
const PRODUCTS_QUERY = `
  query ScanProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        productType
        vendor
        onlineStoreUrl
        media(first: 50) {
          nodes { ... on MediaImage { id alt image { url width height } } }
        }
      }
    }
  }
`;

async function getProductImages(shop, token, maxPages) {
  const out = [];
  let cursor = null;
  let pages = 0;
  do {
    const data = await adminGraphQL(shop, token, PRODUCTS_QUERY, { cursor });
    const conn = data?.products;
    if (!conn) break;
    for (const product of conn.nodes) {
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
          adminUrl: adminLink(shop, `products/${numericId(product.id)}`),
          onlineUrl: product.onlineStoreUrl || null,
        });
      }
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    pages += 1;
  } while (cursor && pages < maxPages);
  return out;
}

// ---------------------- FILES (Content > Files) ----------------------
const FILES_QUERY = `
  query ScanFiles($cursor: String) {
    files(first: 50, after: $cursor, query: "media_type:IMAGE") {
      pageInfo { hasNextPage endCursor }
      nodes { ... on MediaImage { id alt image { url width height } } }
    }
  }
`;

async function getFileImages(shop, token, maxPages) {
  const out = [];
  let cursor = null;
  let pages = 0;
  do {
    let data;
    try {
      data = await adminGraphQL(shop, token, FILES_QUERY, { cursor });
    } catch (e) {
      console.warn('⚠️ files scan skipped:', e.message);
      break;
    }
    const conn = data?.files;
    if (!conn) break;
    for (const node of conn.nodes) {
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
        adminUrl: adminLink(shop, 'content/files'),
        onlineUrl: node.image.url,
      });
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    pages += 1;
  } while (cursor && pages < maxPages);
  return out;
}

// ---------------------- BLOG ARTICLES (featured image) ----------------------
const ARTICLES_QUERY = `
  query ScanArticles($cursor: String) {
    articles(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        image { url width height altText }
        blog { handle }
      }
    }
  }
`;

async function getArticleImages(shop, token, maxPages) {
  const out = [];
  let cursor = null;
  let pages = 0;
  do {
    let data;
    try {
      data = await adminGraphQL(shop, token, ARTICLES_QUERY, { cursor });
    } catch (e) {
      console.warn('⚠️ articles scan skipped:', e.message);
      break;
    }
    const conn = data?.articles;
    if (!conn) break;
    for (const article of conn.nodes) {
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
        adminUrl: adminLink(shop, `articles/${numericId(article.id)}`),
        onlineUrl: article.blog?.handle && article.handle
          ? `https://${shop}/blogs/${article.blog.handle}/${article.handle}`
          : null,
      });
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    pages += 1;
  } while (cursor && pages < maxPages);
  return out;
}

// ---------------------- COLLECTIONS (cover image) ----------------------
const COLLECTIONS_QUERY = `
  query ScanCollections($cursor: String) {
    collections(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id title handle image { url width height altText } }
    }
  }
`;

async function getCollectionImages(shop, token, maxPages) {
  const out = [];
  let cursor = null;
  let pages = 0;
  do {
    let data;
    try {
      data = await adminGraphQL(shop, token, COLLECTIONS_QUERY, { cursor });
    } catch (e) {
      console.warn('⚠️ collections scan skipped:', e.message);
      break;
    }
    const conn = data?.collections;
    if (!conn) break;
    for (const c of conn.nodes) {
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
        adminUrl: adminLink(shop, `collections/${numericId(c.id)}`),
        onlineUrl: c.handle ? `https://${shop}/collections/${c.handle}` : null,
      });
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    pages += 1;
  } while (cursor && pages < maxPages);
  return out;
}

// Fetch every alt-bearing image across the store, from all supported sources.
// Sequential (not parallel) so we don't burst past Shopify's GraphQL cost limit
// and trigger throttling — which was making scans hang.
export async function getAllImages(shop, token, maxPages = 40) {
  const products = await getProductImages(shop, token, maxPages);
  const files = await getFileImages(shop, token, maxPages);
  const articles = await getArticleImages(shop, token, maxPages);
  const collections = await getCollectionImages(shop, token, maxPages);
  return [...products, ...files, ...articles, ...collections];
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
