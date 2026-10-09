# tests/unit/media-page-client-browser-bundle.test.ts

kind: D · status: claimed · reason: Guard the extracted static image catalog against server-only browser dependencies.

## 改动

新增静态图片目录的浏览器打包测试，保留媒体页面与提供商详情页的回归检查。

## 原因

客户端通过 imageRegistry.ts 导入数据库功能开关，导致浏览器构建解析 fs、module、child_process 失败。静态目录需与服务端动态路由隔离，不能用浏览器空模块或禁用功能开关绕过。

## 重做

保留静态目录边界及运行时 IMAGE_PROVIDERS 重新导出。运行 media-page-client-browser-bundle、image-provider-catalog、media-provider-ordering、grok-subscription-images-flag-off 和 image-xai-subscription 单元测试，再构建 runner-base 镜像。若上游已有等效隔离，接受上游实现并移除登记与本说明。
