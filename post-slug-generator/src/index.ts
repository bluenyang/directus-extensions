import { defineHook } from '@directus/extensions-sdk';

export default defineHook(({ filter, _ }) => {
	filter('posts.items.create', autoGenerateSlug);
	filter('posts.items.update', autoGenerateSlug);
  filter('categories.items.create', autoGenerateSlug);
  filter('categories.items.update', autoGenerateSlug);
  filter('tags.items.create', autoGenerateSlug);
  filter('tags.items.update', autoGenerateSlug);
  filter('series.items.create', autoGenerateSlug);
  filter('series.items.update', autoGenerateSlug);
});

function autoGenerateSlug(payload: any, meta: any, context: any) {
  if (payload.title || payload.name) {
    const raw: string | undefined = payload.title ?? payload.name;
    if (!raw) return payload;

    payload.slug = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, '')
      .replace(/\s+/g, '-');

    if (!payload.slug) {
      payload.slug = 'untitled';
    }

    return payload;
  }
}
