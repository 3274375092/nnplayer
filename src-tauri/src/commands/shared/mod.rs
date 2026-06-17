// 跨平台 DTO 边界映射模块。
//
// 设计原则：
//   - 平台特有的转换逻辑集中放这里
//   - 多个 commands/qq_*.rs 共用同一份转换代码
//   - 未来扩展其他平台时按 song_mapper.rs 同模式新建文件

pub mod song_mapper;
