# Architecture decision records

The ADRs are written in Chinese (the project's working language). English titles:

| ADR | Title |
| --- | --- |
| [0001](0001-引用与批注合为一个动作.md) | Highlight and comment are one action; writing a comment makes the difference (terms: see 0008) |
| 0002 | Response markers: the AI writes only numbered markers — about [Diple](https://github.com/waiclay-349687/hermes-diple), published in its repository |
| [0003](0003-md摘录存在按文件的审阅清单.md) | Markdown-document annotations live in a per-file annotation list, not in the conversation's pending list |
| [0004](0004-拆成两个插件用插件事件通信.md) | Two plugins with a shared core, talking through plugin events |
| [0005](0005-后端数据存插件SQLite.md) | Data shared by front end and back end goes into the plugin's own SQLite |
| 0006 | The full version reaches the AI through a plugin `@` reference — about Diple, published in its repository |
| [0007](0007-交接协议的状态机与幂等.md) | Hand-off protocol: claims with generations, stable batches, monotonic outcomes, settled derived by the backend |
| [0008](0008-命名-标注与圈批Diple.md) | Naming: annotation = highlight + comment; the plugin family “Diple · 圈批” |
| [0009](0009-desktop-kit与批次记录与发送接口.md) | Shared desktop kit; one batch catalog; the send module's interface split by role |
| 0010–0011 | The chat's send menu, pins and selection button — about Diple, published in its repository |
| [0012](0012-文档版清单的三种布局与页边状态条.md) | The document page's list: open, collapsed to a margin status bar, or a bottom bar on narrow pages |
| [0013](0013-文档版打开位置随预览与卡片计数合并请求.md) | The document page opens where the Hermes preview opens; the chat cards' counts in one request |
| [0014](0014-文档版批量管理与原文下方编辑.md) | Bulk actions with undo, and the editor below the original |

Terms used in the ADRs are defined in [GLOSSARY.md](../../GLOSSARY.md) (Chinese, with the English words to avoid).
