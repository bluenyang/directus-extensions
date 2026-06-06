import { defineHook } from '@directus/extensions-sdk';
import { ForbiddenError, InvalidPayloadError } from '@directus/errors';

export default defineHook(({ filter }, apiContext) => {
  const ATTR_REF_RULES = [
    {
      collection: 'categories',
      field: 'parent_id',
      refCollection: 'categories',
      scopeField: 'blog_id',
      payloadScopeField: 'blog_id'
    },
  ];


  ATTR_REF_RULES.forEach(({ collection, field, refCollection, scopeField, payloadScopeField }) => {
    const handleEvent = async (payload: any, _meta: any, filterContext: any) => {
      if (!payload[field]) return payload;

      const { ItemsService } = apiContext.services;
      const schema = await apiContext.getSchema();

      const refService = new ItemsService(refCollection, {
        schema,
        accountability: filterContext.accountability,
        knex: filterContext.database,
      });

      const refItem = await refService.readOne(payload[field], {
        fields: [scopeField],
      });

      if (!refItem || refItem[scopeField] !== payload[payloadScopeField]) {
        throw new ForbiddenError();
      }

      return payload;
    };

    filter(`${collection}.items.create`, handleEvent);
    filter(`${collection}.items.update`, handleEvent);
  });
});
