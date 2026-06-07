import { defineHook } from "@directus/extensions-sdk";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";

// editor 이상 = owner | editor

export default defineHook(({ filter }, apiContext) => {
  const ALLOWED_ROLES = ["owner", "editor"];

  /**
   * public 폴더의 UUID를 반환한다.
   * 없으면 null 반환 (생성은 하지 않음 — 어드민이 미리 만들어야 함)
   */
  async function getPublicFolderUUID(schema: any): Promise<string | null> {
    const { services, database } = apiContext;
    const foldersService = new services.ItemsService("directus_folders", {
      schema,
      accountability: null, // 서비스 내부 조회이므로 권한 bypass
      knex: database,
    });

    const result = await foldersService.readByQuery({
      filter: { name: { _eq: "public" }, parent: { _null: true } },
      limit: 1,
      fields: ["id"],
    });

    return result?.[0]?.id ?? null;
  }

  /**
   * public/{blogSlug} 폴더 UUID를 반환한다.
   * 없으면 생성 후 UUID를 반환한다.
   */
  async function getOrCreateBlogFolder(
    blogSlug: string,
    publicFolderUUID: string,
    schema: any,
  ): Promise<string> {
    const { services, database } = apiContext;
    const foldersService = new services.ItemsService("directus_folders", {
      schema,
      accountability: null,
      knex: database,
    });

    const existing = await foldersService.readByQuery({
      filter: {
        name: { _eq: blogSlug },
        parent: { _eq: publicFolderUUID },
      },
      limit: 1,
      fields: ["id"],
    });

    if (existing?.[0]?.id) return existing[0].id;

    // 없으면 생성
    const created = await foldersService.createOne({
      name: blogSlug,
      parent: publicFolderUUID,
    });

    if (existing?.[0]?.id) return String(existing[0].id);
    return String(created);
  }

  /**
   * 현재 유저가 해당 블로그에서 editor 이상인지 확인한다.
   * admin은 bypass.
   */
  async function assertEditorOrAbove(userId: string, blogId: string, schema: any): Promise<void> {
    const { services, database } = apiContext;
    const membersService = new services.ItemsService("blog_members", {
      schema,
      accountability: null,
      knex: database,
    });

    const members = await membersService.readByQuery({
      filter: {
        _and: [
          { user_id: { _eq: userId } },
          { blog_id: { _eq: blogId } },
          { role: { _in: ALLOWED_ROLES } },
        ],
      },
      limit: 1,
      fields: ["id"],
    });

    if (!members?.length) {
      throw new ForbiddenError();
    }
  }

  /**
   * folder UUID가 public/{blogSlug} 하위인지 검증한다.
   */
  async function assertFolderUnderBlogSlug(
    folderUUID: string,
    blogSlug: string,
    publicFolderUUID: string,
    schema: any,
  ): Promise<void> {
    const { services, database } = apiContext;
    const foldersService = new services.ItemsService("directus_folders", {
      schema,
      accountability: null,
      knex: database,
    });

    const folder = await foldersService.readOne(folderUUID, {
      fields: ["id", "name", "parent"],
    });

    if (!folder) {
      throw new InvalidPayloadError({ reason: "존재하지 않는 폴더입니다." });
    }

    // 직접 blog 폴더이거나, blog 폴더의 하위인 경우를 허용
    // folder.parent === publicFolderUUID && folder.name === blogSlug  → public/{blogSlug} 본인
    // folder.parent가 blog 폴더인 경우 → public/{blogSlug}/하위폴더
    const isBlogFolder = folder.parent === publicFolderUUID && folder.name === blogSlug;

    if (isBlogFolder) return;

    // 한 단계 위 부모 확인 (하위 폴더 허용)
    const parentFolder = await foldersService.readOne(folder.parent, {
      fields: ["id", "name", "parent"],
    });

    const isUnderBlogFolder =
      parentFolder?.parent === publicFolderUUID && parentFolder?.name === blogSlug;

    if (!isUnderBlogFolder) {
      throw new ForbiddenError();
    }
  }

  // Hook: directus_folders.items.create
  // 요청 body에 blog_id를 포함해서 보내야 함
  // → 훅에서 blog slug 조회 후 public/{slug} 폴더 UUID로 parent를 강제 설정
  filter("directus_folders.items.create", async (payload: any, _meta, context) => {
    const userId = context.accountability?.user;
    if (!userId) throw new ForbiddenError();
    if (context.accountability?.admin) return payload; // admin bypass

    const blogId: string | undefined = payload._blog_id;
    if (!blogId) {
      throw new InvalidPayloadError({ reason: "blog_id가 필요합니다." });
    }

    const schema = await apiContext.getSchema();
    const { database } = apiContext;

    // editor 이상인지 검증
    await assertEditorOrAbove(userId, blogId, schema);

    // blogs 컬렉션에서 slug 조회
    const blogsService = new apiContext.services.ItemsService("blogs", {
      schema,
      accountability: null,
      knex: database,
    });
    const blog = await blogsService.readOne(blogId, { fields: ["slug"] });
    if (!blog?.slug) {
      throw new InvalidPayloadError({ reason: "블로그 slug를 찾을 수 없습니다." });
    }

    const publicFolderUUID = await getPublicFolderUUID(schema);
    if (!publicFolderUUID) {
      throw new InvalidPayloadError({
        reason: "public 루트 폴더가 존재하지 않습니다. 어드민에게 문의하세요.",
      });
    }

    // public/{slug} 폴더 자동 생성
    const blogFolderUUID = await getOrCreateBlogFolder(blog.slug, publicFolderUUID, schema);

    // parent를 강제로 public/{slug}로 고정
    payload.parent = blogFolderUUID;

    // 내부 전달용 필드 제거
    delete payload._blog_id;

    return payload;
  });

  // Hook: directus_files.items.create (파일 업로드)
  // 요청 body에 blog_id를 포함해서 보내야 함
  // → folder가 없으면 public/{slug}로 자동 설정
  // → folder가 있으면 해당 폴더가 public/{slug} 하위인지 검증
  filter("files.upload", async (payload: any, _meta, context) => {
    const userId = context.accountability?.user;
    if (!userId) throw new ForbiddenError();
    if (context.accountability?.admin) return payload; // admin bypass

    const blogId: string | undefined = payload._blog_id;
    if (!blogId) {
      throw new InvalidPayloadError({ reason: "blog_id가 필요합니다." });
    }

    const schema = await apiContext.getSchema();
    const { database } = apiContext;

    // editor 이상인지 검증
    await assertEditorOrAbove(userId, blogId, schema);

    // slug 조회
    const blogsService = new apiContext.services.ItemsService("blogs", {
      schema,
      accountability: null,
      knex: database,
    });
    const blog = await blogsService.readOne(blogId, { fields: ["slug"] });
    if (!blog?.slug) {
      throw new InvalidPayloadError({ reason: "블로그 slug를 찾을 수 없습니다." });
    }

    const publicFolderUUID = await getPublicFolderUUID(schema);
    if (!publicFolderUUID) {
      throw new InvalidPayloadError({ reason: "public 루트 폴더가 존재하지 않습니다." });
    }

    const blogFolderUUID = await getOrCreateBlogFolder(blog.slug, publicFolderUUID, schema);

    if (!payload.folder) {
      // folder 미지정 → public/{slug}로 자동 설정
      payload.folder = blogFolderUUID;
    } else {
      // folder 지정됨 → public/{slug} 하위인지 검증
      await assertFolderUnderBlogSlug(payload.folder, blog.slug, publicFolderUUID, schema);
    }

    delete payload._blog_id;

    return payload;
  });
});
