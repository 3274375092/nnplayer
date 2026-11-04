// 软件内更新流程的纯决策：不依赖 Vue/Tauri，只在 Node 里做分支测试。
// AboutDialog 负责把 ref 状态传进来，再执行这里返回的动作。

/** 更新状态机的全部取值（AboutDialog 与测试的唯一事实来源）。 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "downloading"
  | "installing"
  | "download-error"
  | "install-error"
  | "installed"
  | "unsupported"
  | "error";

/** 点击「下载并安装」主按钮时应执行的动作。 */
export type InstallAction = "install" | "download" | "none";

/** 决策所需的运行时信息：是否还持有 check() 返回的 Update 句柄、安装包是否已下载。 */
export interface InstallContext {
  hasHandle: boolean;
  downloaded: boolean;
}

/** 决定主按钮下一步做什么：
 *  - available / download-error：需要（重新）下载；
 *  - install-error 且已下载：插件保留已下载字节，只重试 install，不重新下载；
 *  - 其余状态（检查中/下载中/已安装等）没有可执行动作。 */
export function nextInstallAction(
  status: UpdateStatus,
  { hasHandle, downloaded }: InstallContext,
): InstallAction {
  if (!hasHandle) return "none";
  if (status === "available" || status === "download-error") return "download";
  if (status === "install-error" && downloaded) return "install";
  return "none";
}
