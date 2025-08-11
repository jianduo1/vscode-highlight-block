# Highlight Block

<p align="center">
  <img src="https://raw.githubusercontent.com/jianduo1/vscode-highlight-block/main/icon.jpg" alt="Highlight Block Logo" width="128" height="128">
</p>

一个 VS Code 插件，用于根据映射表格配置高亮不同标记的代码块，类似 Cursor 的代码差异显示效果。

## 效果展示

![](https://raw.githubusercontent.com/jianduo1/vscode-highlight-block/main/images/highlight.png)

## 功能特性

- ✨ 支持映射表格配置，不同标记对应不同颜色
- 🎨 类似 Cursor 的代码块背景高亮效果（无边框）
- 🔧 支持 `marker-start` 到 `marker-end` 标记格式
- 📝 支持多种注释格式中的标记
- ⚡ 实时更新高亮效果
- 🎯 初始配置为空，需要用户自定义标记和颜色

## 使用方法

### 基本用法

使用预置标记：

```python
# warn-start
def deprecated_function():
    return "这段代码会显示警告色（橙色）"
# warn-end

# error-start
critical_code = "这行会显示错误色（红色）"
# error-end

# add-start
def new_feature():
    return "新增代码会显示绿色"
# add-end
```

```javascript
// delete-start
// 这段代码会显示删除色（红色）
const oldCode = () => {
    console.log("即将删除的代码");
};
// delete-end

// info-start
const importantInfo = "重要信息会显示蓝色";
// info-end
```

### 支持的标记格式

**标准格式**：`marker-start` ... `marker-end`

- 必须使用完整的开始和结束标记对
- 只有匹配到完整的 start-end 对才会进行背景色渲染
- 单独的 start 标记或未配对的标记不会被高亮

### 如何配置标记

1. **通过 VS Code 设置界面**：
   - 打开设置 (`Ctrl+,`)
   - 搜索 "highlight block"
   - 找到 "Color Mappings" 配置项
   - 点击"添加项"按钮，在表格中添加标记和颜色
   - 左列输入标记名（如：`warn`）
   - 右列输入颜色值（如：`#ffa50020`）

2. **推荐的标记配置**：
   - `info`: `#0080ff20` (蓝色信息)
   - `highlight`: `#ffff0020` (黄色高亮)
   - `tip`: `#4b5a2cff` (绿色提示)
   - `warn`: `#ffa50020` (橙色警告)
   - `error`: `#ff000020` (红色错误)
   - `success`: `#00ff0020` (绿色成功)
   - `delete`: `#ff000020` (红色删除)
   - `add`: `#00ff0020` (绿色新增)

**注意：插件初始配置为空，需要手动添加所需的标记。**

### 命令

- `Highlight Block: 切换高亮块` - 切换当前编辑器的高亮状态
- `Highlight Block: 清除所有高亮` - 清除所有编辑器中的高亮
- `Highlight Block: 显示可用标记` - 显示当前配置的所有可用标记

### 支持的标记格式

插件支持在以下格式中的标记：

- 单行注释：`// warn`, `# error`
- 块注释：`/* info */`
- HTML 注释：`<!-- highlight -->`
- 字符串：`"delete"`, `'add'`
- 直接文本：`warn-start`

## 配置选项

可以在 VS Code 设置中配置以下选项：

### `highlightBlock.colorMappings`
- 类型：`object`
- 默认值：`{}`（空对象）
- 描述：标记与颜色的映射配置，在 VS Code 设置界面中以表格形式编辑
- 格式：`{"标记名": "颜色值"}`
- 推荐配置：
  - `info`: `#0080ff20` (蓝色信息)
  - `highlight`: `#ffff0020` (黄色高亮)
  - `warn`: `#ffa50020` (橙色警告)
  - `error`: `#ff000020` (红色错误)
  - `success`: `#00ff0020` (绿色成功)
  - `delete`: `#ff000020` (红色删除)
  - `add`: `#00ff0020` (绿色新增)

### `highlightBlock.autoHighlight`
- 类型：`boolean`
- 默认值：`true`
- 描述：是否自动检测并高亮标记块

## 配置示例

### 方式一：通过设置界面（推荐）
1. 打开 VS Code 设置界面
2. 搜索 "highlight block"  
3. 在 "Color Mappings" 表格中添加配置项

### 方式二：直接编辑 settings.json
```json
{
    "highlightBlock.colorMappings": {
        "info": "#0080ff20",
        "highlight": "#ffff0020",
        "warn": "#ffa50020", 
        "error": "#ff000020",
        "success": "#00ff0020",
        "delete": "#ff000020",
        "add": "#00ff0020"
    },
    "highlightBlock.autoHighlight": true
}
```

插件会严格匹配标记名称。

### 添加自定义标记

你可以添加任意自定义标记，比如：

```python
# custom-start
def my_custom_function():
    return "自定义标记的代码块"
# custom-end

# note
important_note = "这是一个笔记"
# note-end
```

## 安装

1. 下载 `.vsix` 文件
2. 在 VS Code 中使用 `Extensions: Install from VSIX...` 命令安装

## 开发

```bash
# 打包插件
vsce package --allow-missing-repository
```

## 许可证

MIT License

## 更新日志

### 1.0.0
- 初始版本
- 支持映射表格配置的代码块高亮功能
- 预置7种常用标记和颜色
- 支持 marker-start/marker-end 和 marker/marker-end 格式
- 类似 Cursor 的纯背景色高亮效果