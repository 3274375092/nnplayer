// 入口文件：仅做平台相关的窗口隐藏处理，具体逻辑全部委托给 lib.rs。
// 严禁在此文件中编写业务代码，保持入口文件极简。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nnplayer_lib::run();
}