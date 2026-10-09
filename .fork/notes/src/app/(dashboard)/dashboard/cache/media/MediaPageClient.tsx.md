# src/app/(dashboard)/dashboard/cache/media/MediaPageClient.tsx

kind: D · status: claimed · reason: Prevent the media dashboard client from importing database-backed image routing.

## 改动

将 IMAGE_PROVIDERS 的导入改为 imageProviderCatalog.ts，不改变下拉菜单及格式选择。

## 原因

客户端通过 imageRegistry.ts 导入数据库功能开关，导致浏览器构建解析 fs、module、child_process 失败。静态目录需与服务端动态路由隔离，不能用浏览器空模块或禁用功能开关绕过。

## 重做

保留静态目录边界及运行时 IMAGE_PROVIDERS 重新导出。运行 media-page-client-browser-bundle、image-provider-catalog、media-provider-ordering、grok-subscription-images-flag-off 和 image-xai-subscription 单元测试，再构建 runner-base 镜像。若上游已有等效隔离，接受上游实现并移除登记与本说明。
