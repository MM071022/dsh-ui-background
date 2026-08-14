// dsh-ui-background —— Node 半区（host side）。
// 插件能力完全在浏览器半区（./client.js）实现；这里提供一个空 apply，
// 使该包作为 host 端 Loader 条目存在，从而被 dsh-client-modules 扫描到
// 其 package.json 的 dsh.client 声明并接入 window.__DSH_BOOT__。
export function apply() {}
