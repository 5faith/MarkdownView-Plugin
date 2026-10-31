# MarkdownView

一款**所见即所得**的 Markdown 编辑器：熟悉 Markdown 可以直接写，不熟悉可以用工具栏或菜单排版，随时可切到源码模式。

> 提示：菜单「插入」里可以直接插入表情、告警块、折叠内容、脚注和定义列表。

## 教程

这是一篇讲解如何正确使用 **Markdown** 的排版示例，学会这个很有必要，能让你的文章有更佳清晰的排版。

> 引用文本：Markdown is a text formatting syntax inspired

## 语法指导

### 普通内容

这段内容展示了在内容里面一些排版格式，比如：

- **加粗** - `**加粗**`
- *倾斜* - `*倾斜*`
- ~~删除线~~ - `~~删除线~~`
- `Code 标记` - `` `Code 标记` ``
- [超级链接](https://github.com/5faith/MarkdownView) - `[超级链接](https://github.com/5faith/MarkdownView)`
- [username@gmail.com](mailto:username@gmail.com) - `[username@gmail.com](mailto:username@gmail.com)`

## 大标题 - Heading 3

你可以选择使用 H1 至 H6，使用 `#` 打头，`#` 后面需要有空格。

#### Heading 4

##### Heading 5

###### Heading 6

### 图片

![相对路径图片](./assets/sample-image.svg)
![URL 图片](https://placehold.co/240x100/png?text=Remote+Image)

图片路径会保留在 Markdown 源文中；相对路径图片由扩展宿主转换为 Webview 可访问的 URI，URL 图片由 Webview 直接加载。

### 代码块

#### 普通

```
*emphasize*    **strong**
_emphasize_    __strong__
var a = 1
```

#### 语法高亮支持

如果在 ``` 后面跟随语言名称，可以有语法高亮的效果哦，比如:

##### 演示 Go 代码高亮

```go
package main

import "fmt"

func main() {
	fmt.Println("Hello, 世界")
}
```

##### 演示 Java 高亮

```java
public class HelloWorld {

    public static void main(String[] args) {
        System.out.println("Hello World!");
    }

}
```

> Tip: 语言名称支持下面这些: `ruby`, `python`, `js`, `html`, `erb`, `css`, `coffee`, `bash`, `json`, `yml`, `xml` ...

### 有序、无序、任务列表

#### 无序列表

- Java
  - Spring
    - IoC
    - AOP
- Go
  - gofmt
  - Wide
- Node.js
  - Koa
  - Express

#### 有序列表

1. Node.js
   1. Express
   2. Koa
   3. Sails
2. Go
   1. gofmt
   2. Wide
3. Java
   1. Latke
   2. IDEA

#### 任务列表

- [X] 发布 Sym
- [X] 发布 Solo
- [ ] 预约牙医

### 表格

如果需要展示数据什么的，可以选择使用表格。

| header 1 | header 2 |
| -------- | -------- |
| cell 1   | cell 2   |
| cell 3   | cell 4   |
| cell 5   | cell 6   |

### 折叠内容

默认展开：

<details open>
<summary>这里是摘要部分。</summary>

这里是细节部分。

```js
console.log('hello')
```

</details>

默认收起：

<details>
<summary>点击展开</summary>

这里是折叠内容。

</details>

### 告警块

> [!NOTE]
> 补充信息。

> [!TIP]
> 有用建议。

> [!IMPORTANT]
> 关键信息。

> [!WARNING]
> 需要立即关注的风险。

> [!CAUTION]
> 危险操作，可能造成不可逆后果。

### 定义列表

First Term
: This is the definition of the first term.

Second Term
: This is one definition of the second term.
: This is another definition of the second term.

### 数学公式

行内公式：公式 $a^2 + b^2 = c^2$ 是行内公式。

多行公式块：

$$
\frac{1}{\Bigl(\sqrt{\phi \sqrt{5}}-\phi\Bigr) e^{\frac25 \pi}} = 1+\frac{e^{-2\pi}}{1+\frac{e^{-4\pi}}{1+\cdots}}
$$

行内公式：公式 $a^2 + b^2 = \color{red}c^2$ 是行内。

### 图表（Mermaid）

用 ` ```mermaid ` 代码块画图。只读和编辑模式下，视口内图表即时渲染，其余图表滚动到附近后经全局队列逐个渲染，多图表不卡顿；编辑模式默认显示即时预览，点击图表底部「Mermaid 源码」折叠标题展开可编辑源码面板，修改源码停顿后预览更新，源码暂时无效时保留上一次结果并在下方提示。Markdown 文档中仍保存 Mermaid 围栏代码。

#### 脑图

```mermaid
mindmap
  root((脑图))
    主题 A
      分支 A1
      分支 A2
    主题 B
```

#### 流程图

```mermaid
flowchart TD
    A[开始] --> B{判断}
    B -->|是| C[执行]
    B -->|否| D[结束]
```

#### 流程图（ELK 布局）

```mermaid
flowchart-elk LR
    A[提交订单] --> B[校验库存]
    B --> C{库存充足?}
    C -->|是| D[锁定库存]
    C -->|否| E[通知缺货]
    D --> F[生成支付单]
    F --> G[支付成功]
    G --> H[发货]
```

#### 时序图

```mermaid
sequenceDiagram
    participant U as 用户
    participant S as 服务
    U->>S: 请求
    S-->>U: 响应
```

#### 泳道图

```mermaid
swimlane-beta LR
    subgraph 客户
        a[提交请求]
    end
    subgraph 支持
        b[处理请求]
    end
    a --> b
```

#### 甘特图

```mermaid
gantt
    title 项目计划
    dateFormat YYYY-MM-DD
    section 阶段一
    需求分析 :a1, 2026-01-01, 7d
    编码开发 :after a1, 14d
```

#### 时间线

```mermaid
timeline
    title 版本演进
    2025 : 1.0 发布
    2026 : 2.0 Milkdown 迁移
```

#### 图表（XY）

```mermaid
xychart-beta
    title "数据趋势"
    x-axis [Q1, Q2, Q3, Q4]
    y-axis "数量" 0 --> 100
    bar [23, 45, 67, 89]
    line [23, 45, 67, 89]
```

#### 象限图

```mermaid
quadrantChart
    title 优先级分布
    x-axis 低紧急 --> 高紧急
    y-axis 低重要 --> 高重要
    quadrant-1 优先处理
    quadrant-2 计划安排
    quadrant-3 酌情处理
    quadrant-4 尽快完成
    任务A: [0.8, 0.7]
    任务B: [0.3, 0.6]
```

#### 需求图

```mermaid
requirementDiagram
    requirement loginReq {
        id: 1
        text: the user can log in
        risk: low
        verifymethod: test
    }
    element LoginPage {
        type: simulation
    }
    LoginPage - satisfies -> loginReq
```

#### 类图

```mermaid
classDiagram
    class Animal {
        +String name
        +eat()
    }
    class Dog
    Animal <|-- Dog
```

#### 状态图

```mermaid
stateDiagram-v2
    [*] --> 待处理
    待处理 --> 已完成 : 提交
    已完成 --> [*]
```

#### E-R 图

```mermaid
erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
```

#### 饼图

```mermaid
pie title 资源占比
    "A" : 40
    "B" : 35
    "C" : 25
```

#### 韦恩图

```mermaid
venn-beta
    set A: 3
    set B: 2
    set C: 4
    union A, B
    union B, C
```

#### 用户旅程图

```mermaid
journey
    title 用户下单旅程
    section 浏览
        查看商品: 5: 用户
        加入购物车: 4: 用户
    section 下单
        提交订单: 3: 用户
        完成支付: 5: 用户
```

#### Git 分支图

```mermaid
gitGraph
    commit id: "初始化"
    branch develop
    checkout develop
    commit id: "开发功能"
    checkout main
    merge develop
    commit id: "发布"
```

#### C4 架构图

```mermaid
C4Context
    title 系统上下文图
    Person(user, "用户", "使用本应用")
    System(app, "MarkdownView", "Markdown 编辑器")
    Rel(user, app, "编辑文档")
```

#### 架构图

```mermaid
architecture-beta
    group api(cloud)[服务端]
    service server(server)[应用] in api
    service db(database)[数据库]
    db:L -- R:server
```

#### 块图

```mermaid
block-beta
    columns 3
    A["前端"]:2
    B["后端"]:2
    C["数据库"]
```

#### 网络包图

```mermaid
packet-beta
    0-7: "源端口"
    8-15: "目标端口"
    16-31: "序列号"
```

#### 桑基图

```mermaid
sankey-beta
    source,page,100
    page,signup,30
    page,leave,70
```

#### 雷达图

```mermaid
radar-beta
    axis a["速度"], b["质量"], c["成本"]
    curve c1["方案 A"]{80, 60, 70}
    curve c2["方案 B"]{60, 85, 75}
    max 100
    min 0
```

#### 看板

```mermaid
kanban-beta
    title 迭代任务
    section 待办
        编写文档: toDo
    section 进行中
        实现功能: doing
    section 完成
        需求评审: done
```

#### 鱼骨图

```mermaid
ishikawa
    problem "代码质量下降"
    cause "人员"
        effect "经验不足"
    cause "流程"
        effect "缺少评审"
```

#### 矩形树图

```mermaid
treemap-beta
    "分类 A"
        "条目 A1": 10
        "条目 A2": 20
    "分类 B"
        "条目 B1": 15
        "条目 B2": 25
```

#### 树状图

```mermaid
treeView-beta
    root
        child A
        child B
```

#### Wardley 图

```mermaid
wardley-beta
    component c1[0.5, 0.7]
```

#### 用例图

兼容渲染 `usecase-beta` 示例语法；图表内部会转换为 Mermaid 流程图呈现，文档中的原始语法保持不变。

```mermaid
usecase-beta
actor User("用户")
actor Admin("管理员")
Login("登录")
ViewProfile("查看资料")
ManageUsers("管理用户")

User --> Login
User --> ViewProfile
Admin --> ManageUsers
```

#### 事件建模图

```mermaid
eventmodeling
tf 01 ui ShopUI
tf 02 cmd AddItemToCart
tf 03 evt ItemAdded
tf 04 rmo CartView ->> 03
```

#### Cynefin 图

```mermaid
cynefin-beta
  title 事件响应

  complex
    "调查根因"
    "运行混沌实验"

  complicated
    "分析指标"

  clear
    "最佳实践"

  chaotic
    "紧急处置"
```

#### 语法图（EBNF）

```mermaid
railroad-ebnf-beta
    title 表达式语法

    expression = term ( "+" term | "-" term )* ;
    term = factor ( "*" factor | "/" factor )* ;
    factor = number | "(" expression ")" ;
    number = digit+ ;
    digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
```

#### 语法图（ABNF）

```mermaid
railroad-abnf-beta
    title 邮箱地址

    address = local-part "@" domain ;
    local-part = 1*( ALPHA / DIGIT ) ;
    domain = label *( "." label ) ;
    label = 1*( ALPHA / DIGIT / "-" ) ;
```

#### 语法图（PEG）

```mermaid
railroad-peg-beta
    title 计算器语法

    Expression <- Term (("+" / "-") Term)* ;
    Term <- Factor (("*" / "/") Factor)* ;
    Factor <- Number / "(" Expression ")" ;
    Number <- Digit+ ;
    Digit <- "0" / "1" / "2" / "3" / "4" / "5" / "6" / "7" / "8" / "9" ;
```
