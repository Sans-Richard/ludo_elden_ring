# LudoGraph 知识图谱渲染器

这是 LudoGraph 的知识图谱前端。输入目录只存放符合知识图谱节点—边格式的 JSON，网页负责渲染节点、关系、证据和验证目标。

## 运行

在仓库根目录执行：

```bash
export PYTHONPATH="$PWD/src"
python3 scripts/run_demo.py
```

`scripts/run_demo.py` 和 `scripts/benchmark.py` 都只读取 `input/knowledge-graph.json`，因此更换游戏时只需要替换 `input/` 中的知识图谱文件。

## 验证

```bash
export PYTHONPATH="$PWD/src"
python3 -m unittest discover -s tests -v
python3 scripts/benchmark.py
```

## 网页前端

启动本地静态服务器：

```bash
python3 -m http.server 8000 --directory .
```

然后打开：

```text
http://localhost:8000/web/
```

前端默认加载 `input/knowledge-graph.json`，也支持通过“导入知识图谱 JSON”选择本地 JSON 文件。输入必须符合 `input/knowledge-graph.schema.json`：顶层包含 `schema_version`、`graph.graph_type`、`graph.nodes` 和 `graph.edges`，可选 `verification_targets`。支持局部邻域、路径、环路、树、森林、DAG、一般图和多个子图等标注。参考前端采用深色图谱工作区、左侧布局控制、节点/关系标签开关、适应视图和节点关系详情。

## 项目结构

```text
.
├── input/
│   ├── knowledge-graph.json
│   └── knowledge-graph.schema.json
├── web/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── scripts/
│   ├── run_demo.py
│   └── benchmark.py
├── src/ludograph_quest/
│   ├── __init__.py
│   ├── adapter.py
│   ├── cli.py
│   ├── compiler.py
│   ├── reporting.py
│   └── verifier.py
├── tests/
│   ├── test_compiler.py
│   └── test_verifier.py
├── .gitignore
└── README.md
```

### `input/`：游戏知识图谱输入

这是项目唯一的游戏数据入口。更换游戏时，只需要替换 `input/knowledge-graph.json`，不需要修改网页代码。

- `knowledge-graph.json`：当前游戏的完整知识图谱，包含节点、关系和验证目标。
- `knowledge-graph.schema.json`：知识图谱 JSON 格式规范。

输入的核心结构如下：

```json
{
  "schema_version": "knowledge-graph-1.0",
  "graph": {
    "graph_type": "multi_graph",
    "nodes": [],
    "edges": []
  },
  "verification_targets": []
}
```

节点至少需要 `id`、`type`、`label`；关系至少需要 `from`、`to`、`relation`。支持 `local`、`path`、`cycle`、`tree`、`forest`、`dag`、`general` 和 `multi_graph`。

### `web/`：静态网页前端

- `index.html`：页面结构，包括导航、任务列表、统计信息、证据链和知识图谱工作区。
- `app.js`：加载并校验知识图谱，渲染节点、关系、筛选器和详情面板。
- `styles.css`：页面样式、响应式布局和深色图谱工作区样式。

知识图谱渲染器支持：（我还没弄成社长之前给的demo的样子，以下内容均未完全实现）

- `force` 力导向、`radial` 分层、`grid` 网格三种布局；
- 按节点类型筛选；
- 按名称或 ID 搜索；
- 节点标签和关系标签开关；
- 适应视图和重置布局；
- 点击节点高亮邻居和关系；
- 查看节点描述、ID、关系方向和关联数量。

网页只接受符合知识图谱格式的 JSON。格式错误、重复节点 ID 或指向不存在节点的关系都会被拒绝。

### `scripts/`：输入检查脚本

- `run_demo.py`：读取 `input/knowledge-graph.json`，输出图谱名称、类型、节点数、关系数和验证目标数。
- `benchmark.py`：测量知识图谱文件的读取耗时和规模。

更换 `input/` 中的游戏后，这两个脚本可以直接复用。

### `src/ludograph_quest/`：Python 验证模块

这一部分对知识图谱中的状态、行为、转换和失败分支执行验证。

- `__init__.py`：Python 包入口，导出编译器核心类型和函数。
- `cli.py`：知识图谱命令行验证入口。
- `compiler.py`：校验知识图谱引用并编译为验证模型。
- `reporting.py`：把验证报告转换为 JSON 兼容结构。
- `verifier.py`：执行有限 BFS 可达性、死锁和跨任务干扰检查。

网页和 Python 模块都以知识图谱作为唯一输入格式。

### `tests/`：自动化测试

- `test_compiler.py`：测试知识图谱节点、边和引用校验。
- `test_verifier.py`：测试可达性、死端、环路和报告序列化。

`tests/` 不存放游戏 JSON 数据，测试数据直接在 Python 测试代码中构造。

### 根目录文件

- `.gitignore`：忽略 Python 缓存、虚拟环境、测试缓存和本地环境文件。
- `README.md`：项目运行、输入格式、前端和文件结构说明。

## 数据流

网页数据流：

```text
input/knowledge-graph.json
        ↓
web/app.js
        ↓
知识图谱格式校验
        ↓
任务列表 / 统计信息 / 节点和关系渲染
        ↓
搜索、筛选、布局和节点交互
```

脚本数据流：

```text
input/knowledge-graph.json
        ↓
run_demo.py 或 benchmark.py
        ↓
图谱规模和读取性能信息
```

Python 验证数据流：

```text
input/knowledge-graph.json
        ↓
compiler.py
        ↓
知识图谱验证模型
        ↓
verifier.py
        ↓
reporting.py
```

## 更换游戏

1. 按 `input/knowledge-graph.schema.json` 创建新的知识图谱 JSON。
2. 用新文件替换 `input/knowledge-graph.json`。
3. 刷新网页；脚本也会自动读取新的图谱。

不需要修改 `web/`、`scripts/`、`tests/` 或 `src/`。
