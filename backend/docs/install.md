# demos-3d-backend 环境安装说明

本文档说明如何安装并运行 **demos-3d-backend**（体素网格数据服务）所需的环境。

---

## 1. 环境要求

| 项目 | 要求 |
|------|------|
| **Rust** | **1.85 及以上**（本项目使用 Rust 2024 edition） |
| **操作系统** | macOS / Linux / Windows（已在本机用 Rust 1.93 验证通过） |

除 Rust 外无需安装 Node、Python 等；本项目为纯 Rust 后端。

---

## 2. 安装 Rust（若尚未安装）

### 2.1 使用 rustup（推荐）

在终端执行：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

按提示选择默认安装即可。安装完成后**重新打开终端**或执行：

```bash
source "$HOME/.cargo/env"
```

### 2.2 验证安装

```bash
rustc --version   # 应 >= 1.85，例如 rustc 1.93.0
cargo --version   # 例如 cargo 1.93.0
```

若版本低于 1.85，请升级：

```bash
rustup update
```

---

## 3. 获取项目代码

若尚未克隆，请先进入工作目录并克隆仓库；若已有代码则直接进入项目根目录：

```bash
cd /path/to/your/workspace
# 若需克隆：git clone <repo-url> demos-3d-backend
cd demos-3d-backend
```

---

## 4. 安装依赖并编译

在项目根目录（即包含 `Cargo.toml` 的目录）执行：

```bash
cargo build
```

- 首次运行会从 [crates.io](https://crates.io) 下载并编译所有依赖，可能需要几分钟。
- 编译成功后会在 `target/debug/` 下生成可执行文件 `demos-3d-backend`。

**发布模式编译（可选，体积更小、运行更快）：**

```bash
cargo build --release
```

生成的可执行文件位于 `target/release/demos-3d-backend`。

---

## 5. 运行服务

### 5.1 开发环境运行

```bash
cargo run
```

服务默认在 **http://127.0.0.1:8080** 启动。终端会输出类似：

```
已注册的解析器:
  - vasp

服务器启动在 http://127.0.0.1:8080
资源目录: test/resource
任务 TTL: 30 分钟
```

### 5.2 使用已编译的可执行文件

```bash
# Debug 构建
./target/debug/demos-3d-backend

# 或 Release 构建
./target/release/demos-3d-backend
```

### 5.3 验证服务

在浏览器或使用 curl 访问根路径：

```bash
curl http://127.0.0.1:8080/
```

应返回 JSON，包含 `message`、`endpoint`、`supported_extensions`、`resource_dir` 等字段。

---

## 6. 资源目录说明

服务从**相对当前工作目录**的 `test/resource` 读取体素数据文件（如 `.vasp`）。

- 若该目录不存在，可自行创建：`mkdir -p test/resource`
- 将支持的数据文件放入该目录后，即可通过 API 的 `file` 参数访问，例如：  
  `GET /voxel-grid?file=CHGDIFF.vasp&chunk_size=1000000`

API 详情见 [api.md](./api.md)。

---

## 7. 常用命令速查

| 命令 | 说明 |
|------|------|
| `cargo build` | 编译（Debug） |
| `cargo build --release` | 编译（Release） |
| `cargo run` | 编译并运行 |
| `cargo run --release` | 以 Release 模式编译并运行 |
| `cargo check` | 仅检查能否通过编译，不生成可执行文件 |
| `cargo test` | 运行测试 |

---

## 8. 故障排查

- **`edition 2024` 相关错误**：说明当前 Rust 版本低于 1.85，请执行 `rustup update`。
- **编译时网络超时**：若在国内，可配置 Cargo 使用镜像（如字节跳动或中科大镜像），在 `~/.cargo/config.toml` 中设置 `[source.crates-io]` 的 `replace-with` 与对应镜像源。
- **端口 8080 被占用**：当前端口在 `src/main.rs` 中写死为 8080，若需修改请改源码后重新编译。
