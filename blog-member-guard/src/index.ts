import { defineHook } from '@directus/extensions-sdk';
import { ForbiddenError } from '@directus/errors';

export default defineHook(({ filter }, apiContext) => {
  const collectionsToGuard = ['categories', 'tags', 'series'];

  collectionsToGuard.forEach((collection) => {
    filter(`${collection}.items.create`, async (payload: any, _meta: any, filterContext: any) => {
      const currentUserId = filterContext.accountability?.user;
      if (!currentUserId) throw new ForbiddenError();

      const { ItemsService } = apiContext.services;
      const schema = await apiContext.getSchema();

      const itemsService = new ItemsService('blog_members', {
        schema,
        accountability: filterContext.accountability,
        knex: filterContext.database,
      });

      const members = await itemsService.readByQuery({
        filter: {
          user_id: { _eq: currentUserId },
          blog_id: { _eq: payload.blog_id },
        },
        limit: 1,
      });

      if (!members.length) {
        throw new ForbiddenError();
      }

      return payload;
    });
  });
});
