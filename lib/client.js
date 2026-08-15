// dsh-ui-background —— 浏览器半区（client half）。
//
// 一个自包含的 Web 客户端插件，无任何外部依赖（不需要 require）。功能：
//   背景：多图片列表（本地/URL）、轮播/随机切换、透明度、模糊、暗色遮罩、
//         填充方式（铺满/完整/拉伸/平铺）、宽高（滑杆+手输+锁定比例）、位置、
//         毛玻璃效果（半透明气泡/输入框/侧边栏）、拖拽上传；
//   聊天界面/侧边栏：字体颜色、字体大小 分离调节；
//   配置：导出/导入 JSON、旧版本设置自动迁移。
//
// 界面为右下角浮动按钮 + 面板（纯 DOM），所有设置即时生效并跨刷新保留。
//
// 作用域定位：DSH 组件类名是构建期哈希，因此通过「自定义属性定义检测」在运行时
// 定位作用域根节点并打上 data-dsh-ui-scope 标记：
//   聊天区根节点定义了 --dsh-chat-content-width；
//   侧边栏根节点定义了 --dsh-sidebar-inline-padding。
window.__ModuleLoader__.load({
	id: "dsh-ui-background",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ────────────────────────── 常量 ──────────────────────────
		var STORAGE_KEY = "dsh-ui-background:settings:v1";
		var PLUGIN_NS = "dsh-ui-background";
		var PANEL_ID = "dsh-ui-background-panel";
		var TOGGLE_ID = "dsh-ui-background-toggle";
		var NEXT_ID = "dsh-ui-background-next";
		var LAYER_ID = "dsh-ui-background-layer";
		var OVERLAY_ID = "dsh-ui-background-overlay";
		var DROP_ID = "dsh-ui-background-drop";
		var STYLE_ID = "dsh-ui-background-style";
		var Z = "2147483000"; // 悬浮于一切之上的层级

		var FILL_MODES = ["cover", "contain", "stretch", "tile"];

		var DEFAULTS = {
			images: [],            // 图片列表 [{ id, data?, url?, width, height, name }]
			current: 0,            // 当前图片索引
			backgroundOpacity: 70, // 背景透明度 0–100
			blur: 0,               // 模糊 0–30 px
			overlay: 0,            // 暗色遮罩 0–80 %
			fillMode: "cover",     // cover | contain | stretch | tile
			bgWidth: 0,            // 显示宽度 px（0 = 按填充方式）
			bgHeight: 0,           // 显示高度 px（0 = 按填充方式）
			bgLockRatio: true,     // 保持宽高比
			positionX: 50,         // 水平位置 0–100 %
			positionY: 50,         // 垂直位置 0–100 %
			carousel: false,       // 自动轮播
			carouselInterval: 10,  // 轮播间隔秒
			carouselRandom: false, // 随机顺序
			glass: false,          // 毛玻璃效果
			bgScope: "chat",       // 背景范围：chat=仅对话区 | all=整体贯穿（侧边栏+对话区）
			chatFontColor: "",     // 聊天字体颜色 hex（空 = 跟随主题）
			chatFontSize: 16,      // 聊天内容基准字号 px
			sidebarFontColor: "",  // 侧边栏字体颜色 hex（空 = 跟随主题）
			sidebarFontSize: 100   // 侧边栏字号缩放百分比 85–130
		};

		// 字体 token 表：[token 名, 默认字号, 默认行高, 复合前缀(weight/italic), 字体族变量]
		var FONT_TOKENS = [
			["markdown-h1", 24, 34, "700", "--dsw-font-family"],
			["markdown-h2", 22, 32, "700", "--dsw-font-family"],
			["markdown-h3", 20, 30, "700", "--dsw-font-family"],
			["markdown-h4", 16, 28, "600", "--dsw-font-family"],
			["markdown-base", 16, 28, "400", "--dsw-font-family"],
			["markdown-base-strong", 16, 28, "600", "--dsw-font-family"],
			["markdown-base-italic", 16, 28, "italic 400", "--dsw-font-family"],
			["markdown-base-strong-italic", 16, 28, "italic 600", "--dsw-font-family"],
			["markdown-small", 14, 24, "400", "--dsw-font-family"],
			["markdown-small-strong", 14, 24, "600", "--dsw-font-family"],
			["markdown-small-italic", 14, 24, "italic 400", "--dsw-font-family"],
			["markdown-small-strong-italic", 14, 24, "italic 600", "--dsw-font-family"],
			["markdown-table", 15, 25, "400", "--dsw-font-family"],
			["markdown-table-head", 15, 25, "500", "--dsw-font-family"],
			["markdown-code", 14, 22, "400", "--ds-font-family-code"],
			["markdown-code-block", 13, 22, "400", "--ds-font-family-code"],
			["markdown-code-block-small", 12, 18, "400", "--ds-font-family-code"]
		];

		// ────────────────────────── 工具 ──────────────────────────
		function genId() {
			return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
		}

		function clamp(n, min, max) {
			n = Number(n);
			if (isNaN(n)) return min;
			return Math.min(max, Math.max(min, n));
		}

		function currentImage(s) {
			var list = Array.isArray(s.images) ? s.images : [];
			var idx = clamp(s.current, 0, Math.max(0, list.length - 1));
			return list[idx] || null;
		}

		// ────────────────────────── 设置存取 ──────────────────────────
		function loadSettings() {
			// images 必须是全新空数组：DEFAULTS 是模块级共享对象，浅拷贝会让
			// addFiles/removeImage 在「存储为空」时把默认数组污染（reset 后复活旧背景）。
			var s = Object.assign({}, DEFAULTS, { images: [] });
			var raw = null;
			try {
				var text = localStorage.getItem(STORAGE_KEY);
				if (text) {
					raw = JSON.parse(text);
					Object.assign(s, raw);
				}
			} catch (err) {
				console.warn("[dsh-ui-background] 读取设置失败:", err);
			}
			migrate(s, raw);
			// 迁移（v1/v2/v3 → v4）后写回存储，清除旧键
			if (raw && (raw.fontColor !== undefined || raw.fontSize !== undefined ||
				raw.backgroundScale !== undefined || raw.background !== undefined)) {
				saveSettings(s);
			}
			return s;
		}

		function saveSettings(s) {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
			} catch (err) {
				console.warn("[dsh-ui-background] 保存设置失败（图片可能过多/过大）:", err);
				alert("设置保存失败：图片数据超出浏览器存储上限（约 5MB）。建议改用「添加URL」或减少图片数量/换更小的图。");
			}
		}

		// v1/v2 → v3：旧全局 fontColor/fontSize 迁移为聊天作用域；backgroundScale 换算为像素宽高。
		// v3 → v4：单张 background 迁移为多图列表 images。
		function migrate(s, raw) {
			if (raw && raw.fontColor !== undefined && raw.chatFontColor === undefined) s.chatFontColor = raw.fontColor;
			if (raw && raw.fontSize !== undefined && raw.chatFontSize === undefined) s.chatFontSize = raw.fontSize;
			delete s.fontColor;
			delete s.fontSize;
			if (raw && raw.backgroundScale !== undefined) {
				var iw = Number(s.backgroundWidth) || 0;
				var ih = Number(s.backgroundHeight) || 0;
				var vw = window.innerWidth || document.documentElement.clientWidth || 0;
				var vh = window.innerHeight || document.documentElement.clientHeight || 0;
				var k = (Number(raw.backgroundScale) || 100) / 100;
				if (iw && ih && vw && vh) {
					var cover = Math.max(vw / iw, vh / ih);
					s.bgWidth = Math.max(1, Math.round(iw * cover * k));
					s.bgHeight = Math.max(1, Math.round(ih * cover * k));
				}
			}
			delete s.backgroundScale;
			if (raw && raw.background && !(Array.isArray(s.images) && s.images.length)) {
				s.images = [{
					id: genId(),
					data: String(raw.background),
					width: Number(raw.backgroundWidth) || 0,
					height: Number(raw.backgroundHeight) || 0,
					name: "背景图"
				}];
				s.current = 0;
			}
			delete s.background;
			delete s.backgroundWidth;
			delete s.backgroundHeight;
			return s;
		}

		// 导入时净化未知/越界字段
		function sanitizeSettings(input) {
			var s = Object.assign({}, DEFAULTS);
			var numKeys = ["current", "backgroundOpacity", "blur", "overlay", "bgWidth", "bgHeight",
				"positionX", "positionY", "carouselInterval", "chatFontSize", "sidebarFontSize"];
			var boolKeys = ["bgLockRatio", "carousel", "carouselRandom", "glass"];
			for (var i = 0; i < numKeys.length; i++) {
				var k = numKeys[i];
				if (input[k] !== undefined) s[k] = clamp(input[k], 0, 999999);
			}
			for (var j = 0; j < boolKeys.length; j++) {
				var b = boolKeys[j];
				if (input[b] !== undefined) s[b] = !!input[b];
			}
			if (input.fillMode !== undefined && FILL_MODES.indexOf(input.fillMode) !== -1) s.fillMode = input.fillMode;
			if (input.bgScope === "all" || input.bgScope === "chat") s.bgScope = input.bgScope;
			if (typeof input.chatFontColor === "string") s.chatFontColor = input.chatFontColor;
			if (typeof input.sidebarFontColor === "string") s.sidebarFontColor = input.sidebarFontColor;
			// 范围收窄
			s.backgroundOpacity = clamp(s.backgroundOpacity, 0, 100);
			s.blur = clamp(s.blur, 0, 30);
			s.overlay = clamp(s.overlay, 0, 80);
			s.positionX = clamp(s.positionX, 0, 100);
			s.positionY = clamp(s.positionY, 0, 100);
			s.carouselInterval = clamp(s.carouselInterval, 5, 3600);
			s.chatFontSize = clamp(s.chatFontSize, 12, 24);
			s.sidebarFontSize = clamp(s.sidebarFontSize, 85, 130);
			s.bgWidth = clamp(s.bgWidth, 0, 99999);
			s.bgHeight = clamp(s.bgHeight, 0, 99999);
			if (Array.isArray(input.images)) {
				s.images = [];
				for (var m = 0; m < input.images.length; m++) {
					var im = input.images[m];
					if (!im || typeof im !== "object") continue;
					var data = typeof im.data === "string" && im.data.indexOf("data:") === 0 ? im.data : "";
					var url = typeof im.url === "string" && /^https?:\/\//i.test(im.url) ? im.url : "";
					if (!data && !url) continue;
					s.images.push({
						id: genId(),
						data: data,
						url: url,
						width: clamp(im.width, 0, 99999),
						height: clamp(im.height, 0, 99999),
						name: typeof im.name === "string" ? im.name : "图片"
					});
				}
				s.current = clamp(input.current, 0, Math.max(0, s.images.length - 1));
			}
			return s;
		}

		// ────────────────────────── 颜色工具 ──────────────────────────
		function hexToRgb(hex) {
			var h = String(hex || "").replace("#", "");
			if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
			var n = parseInt(h, 16);
			if (isNaN(n) || h.length !== 6) return { r: 17, g: 17, b: 17 };
			return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
		}

		function rgbToHex(rgb) {
			var m = String(rgb).match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
			if (!m) return "#111111";
			var to2 = function (n) { return ("0" + Number(n).toString(16)).slice(-2); };
			return "#" + to2(m[1]) + to2(m[2]) + to2(m[3]);
		}

		function currentThemeColor() {
			try {
				var probe = document.createElement("span");
				probe.style.color = "var(--dsw-alias-label-primary)";
				document.body.appendChild(probe);
				var c = getComputedStyle(probe).color;
				probe.remove();
				if (c && c.indexOf("rgb") === 0) return rgbToHex(c);
			} catch (err) { /* 忽略 */ }
			return "#111111";
		}

		// ────────────────────────── 字号映射 ──────────────────────────
		function scaledSize(name, base) {
			var min = function (n) { return Math.max(n, 11); };
			switch (name) {
				case "markdown-h1": return base + 8;
				case "markdown-h2": return base + 6;
				case "markdown-h3": return base + 4;
				case "markdown-h4": return base + 2;
				case "markdown-small":
				case "markdown-small-strong":
				case "markdown-small-italic":
				case "markdown-small-strong-italic": return min(base - 2);
				case "markdown-table":
				case "markdown-table-head": return min(base - 1);
				case "markdown-code": return base;
				case "markdown-code-block": return min(base - 3);
				case "markdown-code-block-small": return min(base - 4);
				default: return base;
			}
		}

		function labelDecls(color) {
			var rgb = hexToRgb(color);
			return [
				"--dsw-alias-label-primary: " + color + " !important",
				"--dsw-alias-label-secondary: rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0.78) !important",
				"--dsw-alias-label-tertiary: rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0.55) !important"
			];
		}

		function markdownDecls(base) {
			var decls = [];
			for (var i = 0; i < FONT_TOKENS.length; i++) {
				var t = FONT_TOKENS[i];
				var size = scaledSize(t[0], base);
				var lh = Math.round(size * t[2] / t[1]);
				decls.push("--dsw-font-" + t[0] + ": " + t[3] + " " + size + "px/" + lh + "px var(" + t[4] + ") !important");
				decls.push("--dsw-font-" + t[0] + "-font-size: " + size + "px !important");
				decls.push("--dsw-font-" + t[0] + "-line-height: " + lh + "px !important");
			}
			return decls;
		}

		// 毛玻璃：把聊天区/侧边栏的表面背景 token 换成半透明，让（模糊的）壁纸透出
		// （实现见 buildCss 中的 glass 分支）

		// ────────────────────────── 作用域定位 ──────────────────────────
		var scopes = { chat: null, sidebar: null };

		function findDefinedElement(varName) {
			try {
				var all = document.querySelectorAll("*");
				for (var i = 0; i < all.length; i++) {
					var el = all[i];
					if (!el.parentElement) continue;
					var v = getComputedStyle(el).getPropertyValue(varName).trim();
					if (!v) continue;
					var pv = getComputedStyle(el.parentElement).getPropertyValue(varName).trim();
					if (v !== pv) return el;
				}
			} catch (err) { /* 忽略 */ }
			return null;
		}

		function ensureScopes() {
			if (!scopes.chat || !document.body.contains(scopes.chat)) {
				scopes.chat = findDefinedElement("--dsh-chat-content-width");
				if (scopes.chat) scopes.chat.setAttribute("data-dsh-ui-scope", "chat");
			}
			if (!scopes.sidebar || !document.body.contains(scopes.sidebar)) {
				scopes.sidebar = findDefinedElement("--dsh-sidebar-inline-padding");
				if (scopes.sidebar) scopes.sidebar.setAttribute("data-dsh-ui-scope", "sidebar");
			}
			return scopes;
		}

		// ────────────────────────── CSS 生成 ──────────────────────────
		var PANEL_CSS =
			"#" + PANEL_ID + "{position:fixed;right:16px;bottom:64px;z-index:" + Z + ";width:296px;max-height:74vh;overflow-y:auto;box-sizing:border-box;border-radius:14px;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,#e3e6ea);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.18));color:var(--dsw-alias-label-primary,#111);font-family:var(--dsw-font-family,system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif);font-size:13px;line-height:20px}" +
			"#" + PANEL_ID + "[hidden]{display:none}" +
			"#" + PANEL_ID + " .p-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#e3e6ea);font-weight:600}" +
			"#" + PANEL_ID + " .p-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;font-size:16px;line-height:1;width:24px;height:24px;border-radius:6px}" +
			"#" + PANEL_ID + " .p-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}" +
			"#" + PANEL_ID + " .p-body{padding:2px 12px 12px}" +
			"#" + PANEL_ID + " .p-field{padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}" +
			"#" + PANEL_ID + " .p-sec{display:flex;align-items:center;gap:6px;padding:10px 0 2px;color:var(--dsw-alias-label-secondary,#666);font-size:11px;line-height:16px;letter-spacing:.04em}" +
			"#" + PANEL_ID + " .p-sec:first-child{padding-top:8px}" +
			"#" + PANEL_ID + " .p-sec::before{content:'';width:3px;height:12px;border-radius:2px;background:var(--dsw-static-deepseek-500,#4176e6)}" +
			"#" + PANEL_ID + " .p-label{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}" +
			"#" + PANEL_ID + " .p-val{color:var(--dsw-alias-label-secondary,#666);font-variant-numeric:tabular-nums}" +
			"#" + PANEL_ID + " .p-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
			"#" + PANEL_ID + " button.p-btn{border:1px solid var(--dsw-alias-border-l2,#d8dce1);background:var(--dsw-alias-bg-layer-1,#f7f8fa);color:var(--dsw-alias-label-primary,#111);border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px;line-height:18px;font-family:inherit}" +
			"#" + PANEL_ID + " button.p-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}" +
			"#" + PANEL_ID + " button.p-danger{border-color:var(--dsw-alias-state-error-secondary,rgba(236,19,19,.35));color:var(--dsw-alias-state-error-primary,#ec1313)}" +
			"#" + PANEL_ID + " input[type=range]{width:100%;accent-color:var(--dsw-static-deepseek-500,#4176e6);height:20px;margin:0}" +
			"#" + PANEL_ID + " input[type=color]{width:40px;height:24px;border:1px solid var(--dsw-alias-border-l2,#d8dce1);border-radius:6px;padding:1px;background:transparent;cursor:pointer;flex:none}" +
			"#" + PANEL_ID + " .p-size-row{display:flex;align-items:center;gap:8px}" +
			"#" + PANEL_ID + " .p-size-row input[type=range]{flex:1;min-width:0}" +
			"#" + PANEL_ID + " input[type=number].p-num{width:74px;flex:none;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#d8dce1);background:var(--dsw-alias-bg-layer-1,#f7f8fa);color:var(--dsw-alias-label-primary,#111);border-radius:8px;padding:4px 6px;font-size:12px;line-height:18px;font-family:inherit;text-align:right}" +
			"#" + PANEL_ID + " input[type=number].p-num:focus{outline:none;border-color:var(--dsw-static-deepseek-500,#4176e6)}" +
			"#" + PANEL_ID + " select.p-select{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#d8dce1);background:var(--dsw-alias-bg-layer-1,#f7f8fa);color:var(--dsw-alias-label-primary,#111);border-radius:8px;padding:5px 8px;font-size:12px;line-height:18px;font-family:inherit}" +
			"#" + PANEL_ID + " .p-check{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none}" +
			"#" + PANEL_ID + " .p-check input{accent-color:var(--dsw-static-deepseek-500,#4176e6);margin:0;cursor:pointer}" +
			"#" + PANEL_ID + " .p-images{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}" +
			"#" + PANEL_ID + " .p-thumb{position:relative;width:52px;height:36px;border-radius:8px;overflow:hidden;border:2px solid transparent;cursor:pointer;flex:none;background:rgba(0,0,0,.06)}" +
			"#" + PANEL_ID + " .p-thumb img{width:100%;height:100%;object-fit:cover;display:block}" +
			"#" + PANEL_ID + " .p-thumb-active{border-color:var(--dsw-static-deepseek-500,#4176e6)}" +
			"#" + PANEL_ID + " .p-thumb-del{position:absolute;top:1px;right:1px;width:16px;height:16px;border:none;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:11px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}" +
			"#" + PANEL_ID + " .p-thumb-del:hover{background:rgba(0,0,0,.8)}" +
			"#" + PANEL_ID + " .p-thumb-empty{color:var(--dsw-alias-label-tertiary,#888);font-size:11px;line-height:34px;height:36px}" +
			"#" + PANEL_ID + " .p-import{margin-top:8px}" +
			"#" + PANEL_ID + " .p-import-box{width:100%;box-sizing:border-box;min-height:72px;border:1px solid var(--dsw-alias-border-l2,#d8dce1);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#f7f8fa);color:var(--dsw-alias-label-primary,#111);font-family:var(--ds-font-family-code,Consolas,monospace);font-size:11px;line-height:16px;padding:6px 8px;resize:vertical}" +
			"#" + PANEL_ID + " .p-resetall{margin-top:12px;width:100%}" +
			"#" + PANEL_ID + " .p-hint{color:var(--dsw-alias-label-tertiary,#888);font-size:11px;line-height:16px;margin-top:4px;min-width:0}";

		var TOGGLE_CSS =
			"#" + TOGGLE_ID + ",#" + NEXT_ID + "{position:fixed;right:16px;bottom:16px;z-index:" + Z + ";width:40px;height:40px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,#d8dce1);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#111);cursor:pointer;display:grid;place-items:center;box-shadow:var(--dsw-shadow-lv2,0 4px 12px rgba(0,0,0,.12));padding:0}" +
			"#" + TOGGLE_ID + ":hover,#" + NEXT_ID + ":hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}" +
			"#" + TOGGLE_ID + " svg,#" + NEXT_ID + " svg{display:block}" +
			"#" + NEXT_ID + "{right:64px;display:none}" +
			"#" + NEXT_ID + "[data-show]{display:grid}";

		var LAYER_CSS =
			"#" + LAYER_ID + "{position:fixed;inset:0;z-index:-1;pointer-events:none;background-repeat:no-repeat;background-size:cover;background-position:center;transition:opacity .25s ease,filter .25s ease}" +
			"#" + OVERLAY_ID + "{position:fixed;inset:0;z-index:-1;pointer-events:none}" +
			"#" + DROP_ID + "{position:fixed;inset:0;z-index:" + (Number(Z) + 1) + ";display:none;place-items:center;background:rgba(0,0,0,.55);color:#fff;font-family:var(--dsw-font-family,system-ui,sans-serif);font-size:16px;letter-spacing:.06em;pointer-events:none}" +
			"#" + DROP_ID + "[data-show]{display:grid}";

		function buildCss(s) {
			var rules = [];
			var hasImg = !!currentImage(s);

			// 全局：有背景时让应用底色透明，露出壁纸层
			if (hasImg) {
				rules.push("body, body[data-ds-dark-theme]{--dsw-alias-bg-base: transparent !important}");
			}

			// 聊天界面作用域：字体颜色 + 字体大小 + 毛玻璃表面
			var chatDecls = [];
			if (s.chatFontColor) chatDecls = chatDecls.concat(labelDecls(s.chatFontColor));
			if (s.chatFontSize) chatDecls = chatDecls.concat(markdownDecls(Number(s.chatFontSize) || 16));
			if (chatDecls.length > 0) {
				rules.push('[data-dsh-ui-scope="chat"]{' + chatDecls.join(";") + "}");
			}

			// 侧边栏作用域：字体颜色 + 字号缩放（zoom 缩放，含宽高补偿避免溢出裁剪）
			var sidebarDecls = [];
			if (s.sidebarFontColor) sidebarDecls = sidebarDecls.concat(labelDecls(s.sidebarFontColor));
			var zoom = (Number(s.sidebarFontSize) || 100) / 100;
			if (zoom !== 1) {
				sidebarDecls.push("zoom: " + zoom + " !important");
				sidebarDecls.push("width: calc(100% / " + zoom + ")");
				sidebarDecls.push("height: calc(100% / " + zoom + ")");
			}
			if (sidebarDecls.length > 0) {
				rules.push('[data-dsh-ui-scope="sidebar"]{' + sidebarDecls.join(";") + "}");
			}

			// 毛玻璃：聊天区/侧边栏表面半透明（与模糊配合形成磨砂效果）
			if (s.glass && hasImg) {
				rules.push(
					'[data-dsh-ui-scope="chat"]{' +
					"--dsw-alias-bg-base: transparent !important;" +
					"--dsw-specific-bubble: rgba(255,255,255,0.5) !important;" +
					"--dsw-specific-input-major: rgba(255,255,255,0.55) !important;" +
					"--dsw-alias-markdown-code-block: rgba(255,255,255,0.72) !important;" +
					"--dsw-alias-markdown-inline-code: rgba(255,255,255,0.72) !important;" +
					"--dsw-specific-tip: rgba(255,255,255,0.6) !important;" +
					"--dsw-specific-selector: rgba(255,255,255,0.6) !important;" +
					"--dsw-specific-menu: rgba(255,255,255,0.78) !important;" +
					"}"
				);
				rules.push(
					'body[data-ds-dark-theme] [data-dsh-ui-scope="chat"]{' +
					"--dsw-specific-bubble: rgba(21,21,23,0.55) !important;" +
					"--dsw-specific-input-major: rgba(21,21,23,0.6) !important;" +
					"--dsw-alias-markdown-code-block: rgba(27,27,28,0.75) !important;" +
					"--dsw-alias-markdown-inline-code: rgba(27,27,28,0.75) !important;" +
					"--dsw-specific-tip: rgba(21,21,23,0.65) !important;" +
					"--dsw-specific-selector: rgba(21,21,23,0.65) !important;" +
					"--dsw-specific-menu: rgba(21,21,23,0.8) !important;" +
					"}"
				);
				// 侧边栏半透明：必须覆盖在 body 级 —— 网格列 .sidebarCol 与侧边栏根元素
				// 都使用 --dsw-specific-sidebar-fill 作背景，只覆盖根元素会被外层列挡住。
				rules.push('body{--dsw-specific-sidebar-fill: rgba(255,255,255,0.5) !important}');
				rules.push('body[data-ds-dark-theme]{--dsw-specific-sidebar-fill: rgba(21,21,23,0.55) !important}');
			}

			// 背景范围：整体贯穿 —— 侧边栏列与根元素全部透明，背景图横跨整个窗口。
			// 放在毛玻璃规则之后生成，使「整体背景」优先于玻璃的半透明侧边栏。
			if (s.bgScope === "all" && hasImg) {
				rules.push('body, body[data-ds-dark-theme]{--dsw-specific-sidebar-fill: transparent !important}');
			}

			rules.push(LAYER_CSS);
			rules.push(PANEL_CSS);
			rules.push(TOGGLE_CSS);
			return rules.join("\n");
		}

		// ────────────────────────── DOM ──────────────────────────
		function ensureStyle() {
			var el = document.getElementById(STYLE_ID);
			if (!el) {
				el = document.createElement("style");
				el.id = STYLE_ID;
				el.setAttribute("data-plugin", PLUGIN_NS);
				(document.head || document.documentElement).appendChild(el);
			}
			return el;
		}

		function ensureLayer() {
			var div = document.getElementById(LAYER_ID);
			if (!div) {
				div = document.createElement("div");
				div.id = LAYER_ID;
				div.setAttribute("aria-hidden", "true");
				document.body.appendChild(div);
			}
			return div;
		}

		function ensureOverlay() {
			var div = document.getElementById(OVERLAY_ID);
			if (!div) {
				div = document.createElement("div");
				div.id = OVERLAY_ID;
				div.setAttribute("aria-hidden", "true");
				document.body.appendChild(div);
			}
			return div;
		}

		function ensureDrop() {
			var div = document.getElementById(DROP_ID);
			if (!div) {
				div = document.createElement("div");
				div.id = DROP_ID;
				div.textContent = "松开鼠标以添加为背景图片";
				document.body.appendChild(div);
			}
			return div;
		}

		// 按设置渲染背景图片层 + 遮罩层
		function renderBackground(s) {
			var img = currentImage(s);
			var layer = document.getElementById(LAYER_ID);
			var overlay = document.getElementById(OVERLAY_ID);

			if (!img) {
				if (layer) layer.remove();
				if (overlay) overlay.remove();
				return;
			}

			layer = ensureLayer();
			layer.style.backgroundImage = "url(\"" + (img.data || img.url) + "\")";
			layer.style.opacity = String((Number(s.backgroundOpacity) || 0) / 100);
			var blur = Number(s.blur) || 0;
			layer.style.filter = blur ? "blur(" + blur + "px)" : "";
			layer.style.inset = blur ? "-" + Math.ceil(blur * 1.5) + "px" : "0";
			layer.style.backgroundPosition = (Number(s.positionX) || 50) + "% " + (Number(s.positionY) || 50) + "%";
			layer.style.backgroundRepeat = s.fillMode === "tile" ? "repeat" : "no-repeat";
			var w = Number(s.bgWidth) || 0;
			var h = Number(s.bgHeight) || 0;
			if (w && h) {
				layer.style.backgroundSize = w + "px " + h + "px";
			} else if (s.fillMode === "contain") {
				layer.style.backgroundSize = "contain";
			} else if (s.fillMode === "stretch") {
				layer.style.backgroundSize = "100% 100%";
			} else if (s.fillMode === "tile") {
				layer.style.backgroundSize = "auto";
			} else {
				layer.style.backgroundSize = "cover";
			}

			overlay = ensureOverlay();
			overlay.style.background = "rgba(0,0,0," + (Number(s.overlay) || 0) / 100 + ")";
		}

		function applySettings(s) {
			ensureScopes();
			ensureStyle().textContent = buildCss(s);
			renderBackground(s);
			syncCarousel(s);
			updateFloating(s);
		}

		function updateFloating(s) {
			var next = document.getElementById(NEXT_ID);
			if (next) {
				if (Array.isArray(s.images) && s.images.length > 1) next.setAttribute("data-show", "");
				else next.removeAttribute("data-show");
			}
		}

		// ────────────────────────── 轮播 ──────────────────────────
		var carouselTimer = null;

		function syncCarousel(s) {
			if (carouselTimer) {
				clearInterval(carouselTimer);
				carouselTimer = null;
			}
			if (s.carousel && Array.isArray(s.images) && s.images.length > 1) {
				var interval = (Number(s.carouselInterval) || 10) * 1000;
				carouselTimer = setInterval(function () {
					var cur = loadSettings();
					if (!Array.isArray(cur.images) || cur.images.length < 2) return;
					var next;
					if (cur.carouselRandom) {
						var r;
						do {
							r = Math.floor(Math.random() * cur.images.length);
						} while (r === cur.current && cur.images.length > 1);
						next = r;
					} else {
						next = (cur.current + 1) % cur.images.length;
					}
					if (next !== cur.current) setSettings({ current: next });
				}, interval);
			}
		}

		function nextImage() {
			var s = loadSettings();
			if (!Array.isArray(s.images) || s.images.length < 2) return;
			var next;
			if (s.carouselRandom) {
				var r;
				do {
					r = Math.floor(Math.random() * s.images.length);
				} while (r === s.current && s.images.length > 1);
				next = r;
			} else {
				next = (s.current + 1) % s.images.length;
			}
			setSettings({ current: next });
		}

		// ────────────────────────── 图片处理 ──────────────────────────
		function readFileAsDataUrl(file) {
			return new Promise(function (resolve, reject) {
				var reader = new FileReader();
				reader.onload = function () { resolve(reader.result); };
				reader.onerror = function () { reject(reader.error || new Error("读取失败")); };
				reader.readAsDataURL(file);
			});
		}

		function downscaleDataUrl(dataUrl, maxDim, quality) {
			return new Promise(function (resolve) {
				var img = new Image();
				img.onload = function () {
					try {
						var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
						var w = Math.max(1, Math.round(img.width * scale));
						var h = Math.max(1, Math.round(img.height * scale));
						var canvas = document.createElement("canvas");
						canvas.width = w;
						canvas.height = h;
						var ctx = canvas.getContext("2d");
						ctx.drawImage(img, 0, 0, w, h);
						resolve(canvas.toDataURL("image/jpeg", quality));
					} catch (err) {
						resolve(dataUrl);
					}
				};
				img.onerror = function () { resolve(dataUrl); };
				img.src = dataUrl;
			});
		}

		function readImageDims(dataUrl) {
			return new Promise(function (resolve) {
				var img = new Image();
				img.onload = function () {
					resolve({ w: img.naturalWidth || img.width || 0, h: img.naturalHeight || img.height || 0 });
				};
				img.onerror = function () { resolve({ w: 0, h: 0 }); };
				img.src = dataUrl;
			});
		}

		function addFiles(fileList) {
			var files = [];
			for (var i = 0; i < fileList.length; i++) {
				var f = fileList[i];
				if (f && f.type && f.type.indexOf("image/") === 0) files.push(f);
			}
			if (!files.length) return;
			Promise.all(files.map(function (file) {
				return readFileAsDataUrl(file)
					.then(function (dataUrl) {
						if (dataUrl.length > 1500000) return downscaleDataUrl(dataUrl, 1600, 0.82);
						return dataUrl;
					})
					.then(function (dataUrl) {
						if (dataUrl.length > 2200000) return downscaleDataUrl(dataUrl, 1200, 0.75);
						return dataUrl;
					})
					.then(function (dataUrl) {
						return readImageDims(dataUrl).then(function (d) {
							return { data: dataUrl, width: d.w, height: d.h, name: file.name };
						});
					});
			})).then(function (imgs) {
				var s = loadSettings();
				imgs.forEach(function (im) {
					im.id = genId();
					s.images.push(im);
				});
				s.current = s.images.length - 1;
				saveSettings(s);
				applySettings(s);
				updatePanel();
			}).catch(function (err) {
				alert("无法读取图片: " + (err && err.message ? err.message : err));
			});
		}

		function addUrlPrompt() {
			var url = prompt("输入图片 URL（http/https 开头）");
			if (!url) return;
			url = String(url).trim();
			if (!/^https?:\/\//i.test(url)) {
				alert("请输入 http(s) 开头的图片地址");
				return;
			}
			readImageDims(url).then(function (d) {
				var s = loadSettings();
				s.images.push({ id: genId(), url: url, width: d.w, height: d.h, name: "网络图片" });
				s.current = s.images.length - 1;
				saveSettings(s);
				applySettings(s);
				updatePanel();
			});
		}

		function removeImage(i) {
			var s = loadSettings();
			if (!Array.isArray(s.images) || !s.images.length) return;
			s.images.splice(i, 1);
			if (s.current >= s.images.length) s.current = Math.max(0, s.images.length - 1);
			if (!s.images.length) {
				s.bgWidth = 0;
				s.bgHeight = 0;
			}
			saveSettings(s);
			applySettings(s);
			updatePanel();
		}

		// ────────────────────────── 导入 / 导出 ──────────────────────────
		function exportConfig() {
			var s = loadSettings();
			var json = JSON.stringify(s, null, 2);
			var status = panelQuery('[data-val="ioStatus"]');
			function done(msg) { if (status) status.textContent = msg; }
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(json).then(
						function () { done("已复制到剪贴板"); },
						function () { fallbackExport(json); }
					);
				} else {
					fallbackExport(json);
				}
			} catch (err) {
				fallbackExport(json);
			}
		}

		function fallbackExport(json) {
			var panel = document.getElementById(PANEL_ID);
			if (!panel) return;
			var wrap = panel.querySelector(".p-import");
			var box = panel.querySelector('[data-set="importText"]');
			if (wrap) wrap.hidden = false;
			if (box) box.value = json;
			var status = panel.querySelector('[data-val="ioStatus"]');
			if (status) status.textContent = "已填入下方文本框，请手动复制";
		}

		function importApply() {
			var panel = document.getElementById(PANEL_ID);
			if (!panel) return;
			var box = panel.querySelector('[data-set="importText"]');
			var status = panel.querySelector('[data-val="ioStatus"]');
			try {
				var parsed = JSON.parse(box.value);
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("需要 JSON 对象");
				var s = sanitizeSettings(parsed);
				saveSettings(s);
				applySettings(s);
				updatePanel();
				var wrap = panel.querySelector(".p-import");
				if (wrap) wrap.hidden = true;
				if (status) status.textContent = "导入成功";
			} catch (err) {
				if (status) status.textContent = "导入失败: " + (err && err.message ? err.message : err);
			}
		}

		// ────────────────────────── 拖拽上传 ──────────────────────────
		var dragDepth = 0;

		function showDrop(show) {
			var div = document.getElementById(DROP_ID);
			if (!div) return;
			if (show) div.setAttribute("data-show", "");
			else div.removeAttribute("data-show");
		}

		function hasFiles(ev) {
			return ev && ev.dataTransfer && ev.dataTransfer.types &&
				Array.prototype.indexOf.call(ev.dataTransfer.types, "Files") !== -1;
		}

		function onDragEnter(ev) {
			if (!hasFiles(ev)) return;
			dragDepth++;
			showDrop(true);
		}

		function onDragOver(ev) {
			if (!hasFiles(ev)) return;
			ev.preventDefault();
			if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
			showDrop(true);
		}

		function onDragLeave() {
			dragDepth = Math.max(0, dragDepth - 1);
			if (dragDepth === 0) showDrop(false);
		}

		function onDrop(ev) {
			dragDepth = 0;
			showDrop(false);
			if (!ev.dataTransfer || !ev.dataTransfer.files || !ev.dataTransfer.files.length) return;
			ev.preventDefault();
			addFiles(ev.dataTransfer.files);
		}

		// ────────────────────────── 面板 UI ──────────────────────────
		var panel = null;

		function panelQuery(sel) {
			return panel ? panel.querySelector(sel) : null;
		}

		function buildPanel() {
			if (document.getElementById(PANEL_ID)) return;

			panel = document.createElement("div");
			panel.id = PANEL_ID;
			panel.hidden = true;
			panel.innerHTML =
				'<div class="p-hd"><span>界面美化</span><button type="button" class="p-close" data-act="close" title="关闭">×</button></div>' +
				'<div class="p-body">' +
					'<div class="p-sec">背景图片</div>' +
					'<div class="p-field">' +
						'<div class="p-images" data-area="images"></div>' +
						'<div class="p-row">' +
							'<button type="button" class="p-btn" data-act="add">添加图片…</button>' +
							'<button type="button" class="p-btn" data-act="addUrl">添加URL…</button>' +
							'<button type="button" class="p-btn" data-act="next">下一张</button>' +
						'</div>' +
						'<input type="file" accept="image/*" multiple hidden>' +
						'<div class="p-hint">支持多张本地图片与网络图片 URL；点击缩略图切换，× 删除。也可以直接把图片拖进窗口任意位置。</div>' +
					'</div>' +
					'<div class="p-field">' +
						'<label class="p-check"><input type="checkbox" data-set="carousel"> <span>自动轮播</span></label>' +
						'<div class="p-row" style="margin-top:6px">' +
							'<label class="p-check"><input type="checkbox" data-set="carouselRandom"> <span>随机顺序</span></label>' +
							'<span class="p-hint">间隔</span>' +
							'<input type="number" class="p-num" min="5" max="3600" step="5" data-set="interval">' +
							'<span class="p-hint">秒</span>' +
						'</div>' +
					'</div>' +
					'<div class="p-sec">背景样式</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>透明度</span><span class="p-val" data-val="opacity"></span></div>' +
						'<input type="range" min="0" max="100" step="1" data-set="opacity">' +
					'</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>模糊</span><span class="p-val" data-val="blur"></span></div>' +
						'<input type="range" min="0" max="30" step="1" data-set="blur">' +
					'</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>暗色遮罩</span><span class="p-val" data-val="overlay"></span></div>' +
						'<input type="range" min="0" max="80" step="1" data-set="overlay">' +
					'</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>填充方式</span></div>' +
						'<select class="p-select" data-set="fill">' +
							'<option value="cover">铺满（裁切）</option>' +
							'<option value="contain">完整显示</option>' +
							'<option value="stretch">拉伸填满</option>' +
							'<option value="tile">平铺重复</option>' +
						'</select>' +
					'</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>背景范围</span></div>' +
						'<select class="p-select" data-set="scope">' +
							'<option value="chat">仅对话区</option>' +
							'<option value="all">整体贯穿（侧边栏 + 对话区）</option>' +
						'</select>' +
						'<div class="p-hint">整体贯穿：背景图横跨侧边栏与对话界面，合成一张完整壁纸；仅对话区：侧边栏保留自身底色。</div>' +
					'</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>图片宽度</span><span class="p-val" data-val="w"></span></div>' +
						'<div class="p-size-row">' +
							'<input type="range" min="100" max="8000" step="10" data-set="w">' +
							'<input type="number" class="p-num" min="0" max="99999" step="10" data-set="wNum" title="0 = 按填充方式">' +
						'</div>' +
					'</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>图片高度</span><span class="p-val" data-val="h"></span></div>' +
						'<div class="p-size-row">' +
							'<input type="range" min="100" max="8000" step="10" data-set="h">' +
							'<input type="number" class="p-num" min="0" max="99999" step="10" data-set="hNum" title="0 = 按填充方式">' +
						'</div>' +
					'</div>' +
					'<div class="p-field">' +
						'<label class="p-check"><input type="checkbox" data-set="lock"> <span>保持宽高比（按图片原始比例联动）</span></label>' +
					'</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>水平位置</span><span class="p-val" data-val="posX"></span></div>' +
						'<input type="range" min="0" max="100" step="1" data-set="posX">' +
					'</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>垂直位置</span><span class="p-val" data-val="posY"></span></div>' +
						'<input type="range" min="0" max="100" step="1" data-set="posY">' +
					'</div>' +
					'<div class="p-field">' +
						'<label class="p-check"><input type="checkbox" data-set="glass"> <span>毛玻璃效果</span></label>' +
						'<div class="p-hint">开启后聊天气泡、输入框、侧边栏变为半透明，配合「模糊」呈现磨砂质感。</div>' +
					'</div>' +
					'<div class="p-sec">聊天界面</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>字体颜色</span><button type="button" class="p-btn" data-act="resetChatColor">默认</button></div>' +
						'<div class="p-row">' +
							'<input type="color" data-set="chatColor">' +
							'<span class="p-hint" data-val="chatColor"></span>' +
						'</div>' +
					'</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>字体大小</span><span class="p-val" data-val="chatSize"></span></div>' +
						'<input type="range" min="12" max="24" step="1" data-set="chatSize">' +
					'</div>' +
					'<div class="p-sec">侧边栏</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>字体颜色</span><button type="button" class="p-btn" data-act="resetSidebarColor">默认</button></div>' +
						'<div class="p-row">' +
							'<input type="color" data-set="sidebarColor">' +
							'<span class="p-hint" data-val="sidebarColor"></span>' +
						'</div>' +
					'</div>' +
					'<div class="p-field">' +
						'<div class="p-label"><span>字体大小</span><span class="p-val" data-val="sidebarSize"></span></div>' +
						'<input type="range" min="85" max="130" step="5" data-set="sidebarSize">' +
					'</div>' +
					'<div class="p-sec">其他</div>' +
					'<div class="p-field">' +
						'<div class="p-row">' +
							'<button type="button" class="p-btn" data-act="export">导出配置</button>' +
							'<button type="button" class="p-btn" data-act="import">导入配置</button>' +
						'</div>' +
						'<div class="p-import" hidden>' +
							'<textarea class="p-import-box" data-set="importText" placeholder="粘贴配置 JSON…"></textarea>' +
							'<div class="p-row" style="margin-top:6px">' +
								'<button type="button" class="p-btn" data-act="importApply">应用</button>' +
								'<button type="button" class="p-btn" data-act="importCancel">取消</button>' +
							'</div>' +
						'</div>' +
						'<div class="p-hint" data-val="ioStatus"></div>' +
					'</div>' +
					'<button type="button" class="p-btn p-resetall" data-act="resetAll">重置全部</button>' +
				'</div>';
			document.body.appendChild(panel);

			var toggle = document.createElement("button");
			toggle.id = TOGGLE_ID;
			toggle.type = "button";
			toggle.title = "界面美化";
			toggle.setAttribute("aria-label", "界面美化");
			toggle.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" stroke="none"/><path d="M21 15l-4.5-4.5L7 20"/></svg>';
			document.body.appendChild(toggle);

			var next = document.createElement("button");
			next.id = NEXT_ID;
			next.type = "button";
			next.title = "下一张背景";
			next.setAttribute("aria-label", "下一张背景");
			next.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
			document.body.appendChild(next);

			var fileInput = panel.querySelector('input[type="file"]');

			panel.addEventListener("click", function (ev) {
				var btn = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
				if (!btn) return;
				switch (btn.getAttribute("data-act")) {
					case "close": panel.hidden = true; break;
					case "add": fileInput.click(); break;
					case "addUrl": addUrlPrompt(); break;
					case "next": nextImage(); break;
					case "resetChatColor": setSettings({ chatFontColor: "" }); break;
					case "resetSidebarColor": setSettings({ sidebarFontColor: "" }); break;
					case "export": exportConfig(); break;
					case "import":
						var wrap = panel.querySelector(".p-import");
						if (wrap) wrap.hidden = false;
						var box = panel.querySelector('[data-set="importText"]');
						if (box) box.focus();
						break;
					case "importApply": importApply(); break;
					case "importCancel":
						var w2 = panel.querySelector(".p-import");
						if (w2) w2.hidden = true;
						break;
					case "resetAll": resetAll(); break;
				}
			});

			fileInput.addEventListener("change", function () {
				if (fileInput.files && fileInput.files.length) addFiles(fileInput.files);
				fileInput.value = "";
			});

			panel.addEventListener("input", function (ev) {
				var el = ev.target;
				var key = el && el.getAttribute ? el.getAttribute("data-set") : null;
				if (!key) return;
				if (key === "opacity") setSettings({ backgroundOpacity: Number(el.value) });
				else if (key === "blur") setSettings({ blur: Number(el.value) });
				else if (key === "overlay") setSettings({ overlay: Number(el.value) });
				else if (key === "w") setBgDimension("w", Number(el.value));
				else if (key === "h") setBgDimension("h", Number(el.value));
				else if (key === "posX") setSettings({ positionX: Number(el.value) });
				else if (key === "posY") setSettings({ positionY: Number(el.value) });
				else if (key === "chatSize") setSettings({ chatFontSize: Number(el.value) });
				else if (key === "sidebarSize") setSettings({ sidebarFontSize: Number(el.value) });
				else if (key === "chatColor") setSettings({ chatFontColor: el.value });
				else if (key === "sidebarColor") setSettings({ sidebarFontColor: el.value });
			});

			// 数字输入框（手动输入）、下拉与勾选框使用 change 事件
			panel.addEventListener("change", function (ev) {
				var el = ev.target;
				var key = el && el.getAttribute ? el.getAttribute("data-set") : null;
				if (!key) return;
				if (key === "wNum") setBgDimension("w", Math.max(0, Math.round(Number(el.value) || 0)));
				else if (key === "hNum") setBgDimension("h", Math.max(0, Math.round(Number(el.value) || 0)));
				else if (key === "lock") setSettings({ bgLockRatio: el.checked });
				else if (key === "fill") setSettings({ fillMode: el.value });
				else if (key === "scope") setSettings({ bgScope: el.value === "all" ? "all" : "chat" });
				else if (key === "carousel") setSettings({ carousel: el.checked });
				else if (key === "carouselRandom") setSettings({ carouselRandom: el.checked });
				else if (key === "interval") setSettings({ carouselInterval: Math.max(5, Number(el.value) || 10) });
				else if (key === "glass") setSettings({ glass: el.checked });
			});

			toggle.addEventListener("click", function () {
				panel.hidden = !panel.hidden;
				if (!panel.hidden) updatePanel();
			});

			next.addEventListener("click", function () {
				nextImage();
			});
		}

		function renderImages(s) {
			var area = panelQuery('[data-area="images"]');
			if (!area) return;
			area.innerHTML = "";
			var list = Array.isArray(s.images) ? s.images : [];
			if (!list.length) {
				var empty = document.createElement("div");
				empty.className = "p-thumb-empty";
				empty.textContent = "尚未添加背景图片";
				area.appendChild(empty);
				return;
			}
			list.forEach(function (img, i) {
				var wrap = document.createElement("div");
				wrap.className = "p-thumb" + (i === s.current ? " p-thumb-active" : "");
				wrap.title = img.name || ("图片 " + (i + 1));
				var thumb = document.createElement("img");
				thumb.src = img.data || img.url;
				thumb.alt = "";
				thumb.addEventListener("click", function () {
					if (i !== s.current) setSettings({ current: i });
				});
				var del = document.createElement("button");
				del.type = "button";
				del.className = "p-thumb-del";
				del.textContent = "×";
				del.setAttribute("aria-label", "删除");
				del.addEventListener("click", function (ev) {
					ev.stopPropagation();
					removeImage(i);
				});
				wrap.appendChild(thumb);
				wrap.appendChild(del);
				area.appendChild(wrap);
			});
		}

		function updatePanel() {
			if (!panel) return;
			var s = loadSettings();
			renderImages(s);

			var hasImg = !!currentImage(s);
			var many = Array.isArray(s.images) && s.images.length > 1;

			var opRange = panelQuery('[data-set="opacity"]');
			var opVal = panelQuery('[data-val="opacity"]');
			var blurRange = panelQuery('[data-set="blur"]');
			var blurVal = panelQuery('[data-val="blur"]');
			var overlayRange = panelQuery('[data-set="overlay"]');
			var overlayVal = panelQuery('[data-val="overlay"]');
			var fillSel = panelQuery('[data-set="fill"]');
			var scopeSel = panelQuery('[data-set="scope"]');
			var wSlider = panelQuery('[data-set="w"]');
			var wNum = panelQuery('[data-set="wNum"]');
			var wVal = panelQuery('[data-val="w"]');
			var hSlider = panelQuery('[data-set="h"]');
			var hNum = panelQuery('[data-set="hNum"]');
			var hVal = panelQuery('[data-val="h"]');
			var lock = panelQuery('[data-set="lock"]');
			var posX = panelQuery('[data-set="posX"]');
			var posXVal = panelQuery('[data-val="posX"]');
			var posY = panelQuery('[data-set="posY"]');
			var posYVal = panelQuery('[data-val="posY"]');
			var glass = panelQuery('[data-set="glass"]');
			var carousel = panelQuery('[data-set="carousel"]');
			var carouselRandom = panelQuery('[data-set="carouselRandom"]');
			var interval = panelQuery('[data-set="interval"]');
			var chatColor = panelQuery('[data-set="chatColor"]');
			var chatColorVal = panelQuery('[data-val="chatColor"]');
			var chatSize = panelQuery('[data-set="chatSize"]');
			var chatSizeVal = panelQuery('[data-val="chatSize"]');
			var sideColor = panelQuery('[data-set="sidebarColor"]');
			var sideColorVal = panelQuery('[data-val="sidebarColor"]');
			var sideSize = panelQuery('[data-set="sidebarSize"]');
			var sideSizeVal = panelQuery('[data-val="sidebarSize"]');

			var setDisabled = function (el, disabled) { if (el) el.disabled = disabled; };
			[opRange, blurRange, overlayRange, fillSel, scopeSel, wSlider, wNum, hSlider, hNum, lock, posX, posY, glass].forEach(function (el) { setDisabled(el, !hasImg); });
			[carousel, carouselRandom, interval].forEach(function (el) { setDisabled(el, !many); });

			if (opRange) opRange.value = String(s.backgroundOpacity);
			if (opVal) opVal.textContent = s.backgroundOpacity + "%";
			if (blurRange) blurRange.value = String(s.blur);
			if (blurVal) blurVal.textContent = s.blur ? s.blur + "px" : "无";
			if (overlayRange) overlayRange.value = String(s.overlay);
			if (overlayVal) overlayVal.textContent = s.overlay ? s.overlay + "%" : "无";
			if (fillSel) fillSel.value = s.fillMode;
			if (scopeSel) scopeSel.value = s.bgScope === "all" ? "all" : "chat";
			if (wSlider) wSlider.value = String(s.bgWidth || 100);
			if (wNum) wNum.value = s.bgWidth ? String(s.bgWidth) : "";
			if (wVal) wVal.textContent = s.bgWidth ? s.bgWidth + "px" : "自动";
			if (hSlider) hSlider.value = String(s.bgHeight || 100);
			if (hNum) hNum.value = s.bgHeight ? String(s.bgHeight) : "";
			if (hVal) hVal.textContent = s.bgHeight ? s.bgHeight + "px" : "自动";
			if (lock) lock.checked = !!s.bgLockRatio;
			if (posX) posX.value = String(s.positionX);
			if (posXVal) posXVal.textContent = s.positionX + "%";
			if (posY) posY.value = String(s.positionY);
			if (posYVal) posYVal.textContent = s.positionY + "%";
			if (glass) glass.checked = !!s.glass;
			if (carousel) carousel.checked = !!s.carousel;
			if (carouselRandom) carouselRandom.checked = !!s.carouselRandom;
			if (interval) interval.value = String(s.carouselInterval);
			if (chatSize) chatSize.value = String(s.chatFontSize);
			if (chatSizeVal) chatSizeVal.textContent = s.chatFontSize + "px";
			if (sideSize) sideSize.value = String(s.sidebarFontSize);
			if (sideSizeVal) sideSizeVal.textContent = s.sidebarFontSize + "%";
			if (s.chatFontColor) {
				if (chatColor) chatColor.value = s.chatFontColor;
				if (chatColorVal) chatColorVal.textContent = "已自定义";
			} else {
				if (chatColor) chatColor.value = currentThemeColor();
				if (chatColorVal) chatColorVal.textContent = "未自定义";
			}
			if (s.sidebarFontColor) {
				if (sideColor) sideColor.value = s.sidebarFontColor;
				if (sideColorVal) sideColorVal.textContent = "已自定义";
			} else {
				if (sideColor) sideColor.value = currentThemeColor();
				if (sideColorVal) sideColorVal.textContent = "未自定义";
			}
		}

		function setSettings(patch) {
			var s = loadSettings();
			for (var k in patch) s[k] = patch[k];
			saveSettings(s);
			applySettings(s);
			updatePanel();
		}

		// 设置图片显示宽/高（px，0 = 自动）。开启「保持宽高比」时，按图片原始比例联动另一维。
		function setBgDimension(which, px) {
			var s = loadSettings();
			px = Math.max(0, Math.round(Number(px) || 0));
			var img = currentImage(s);
			var iw = img ? Number(img.width) || 0 : 0;
			var ih = img ? Number(img.height) || 0 : 0;
			if (which === "w") {
				s.bgWidth = px;
				if (s.bgLockRatio && px > 0 && iw && ih) s.bgHeight = Math.round(px * ih / iw);
			} else {
				s.bgHeight = px;
				if (s.bgLockRatio && px > 0 && iw && ih) s.bgWidth = Math.round(px * iw / ih);
			}
			saveSettings(s);
			applySettings(s);
			updatePanel();
		}

		function resetAll() {
			try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* 忽略 */ }
			applySettings(loadSettings());
			updatePanel();
		}

		// ────────────────────────── 插件入口 ──────────────────────────
		var observer = null;
		var onResize = null;
		var dragHandlers = null;

		exports.inject = [];
		exports.apply = function (ctx) {
			function boot() {
				try {
					buildPanel();
					ensureDrop();
					applySettings(loadSettings());
					updatePanel();

					onResize = function () {
						var s = loadSettings();
						var layer = document.getElementById(LAYER_ID);
						if (currentImage(s) && layer) renderBackground(s);
					};
					window.addEventListener("resize", onResize);

					dragHandlers = {
						dragenter: onDragEnter,
						dragover: onDragOver,
						dragleave: onDragLeave,
						drop: onDrop
					};
					window.addEventListener("dragenter", dragHandlers.dragenter);
					window.addEventListener("dragover", dragHandlers.dragover);
					window.addEventListener("dragleave", dragHandlers.dragleave);
					window.addEventListener("drop", dragHandlers.drop);

					if ((!scopes.chat || !scopes.sidebar) && typeof MutationObserver !== "undefined") {
						observer = new MutationObserver(function () {
							if (scopes.chat && scopes.sidebar) {
								observer.disconnect();
								observer = null;
								return;
							}
							if (document.getElementById(STYLE_ID)) {
								applySettings(loadSettings());
							}
						});
						observer.observe(document.body, { childList: true, subtree: true });
					}
				} catch (err) {
					console.error("[dsh-ui-background] 初始化失败:", err);
				}
			}
			if (document.readyState === "loading") {
				document.addEventListener("DOMContentLoaded", boot, { once: true });
			} else {
				boot();
			}
			ctx.on("dispose", cleanup);
		};

		function cleanup() {
			var el;
			if ((el = document.getElementById(STYLE_ID))) el.remove();
			if ((el = document.getElementById(LAYER_ID))) el.remove();
			if ((el = document.getElementById(OVERLAY_ID))) el.remove();
			if ((el = document.getElementById(DROP_ID))) el.remove();
			if ((el = document.getElementById(PANEL_ID))) el.remove();
			if ((el = document.getElementById(TOGGLE_ID))) el.remove();
			if ((el = document.getElementById(NEXT_ID))) el.remove();
			if (scopes.chat) scopes.chat.removeAttribute("data-dsh-ui-scope");
			if (scopes.sidebar) scopes.sidebar.removeAttribute("data-dsh-ui-scope");
			scopes.chat = null;
			scopes.sidebar = null;
			if (observer) { observer.disconnect(); observer = null; }
			if (onResize) { window.removeEventListener("resize", onResize); onResize = null; }
			if (dragHandlers) {
				window.removeEventListener("dragenter", dragHandlers.dragenter);
				window.removeEventListener("dragover", dragHandlers.dragover);
				window.removeEventListener("dragleave", dragHandlers.dragleave);
				window.removeEventListener("drop", dragHandlers.drop);
				dragHandlers = null;
			}
			if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
			panel = null;
		}

		return module.exports;
	}
});
