const vscode = require("vscode");

/**折叠范围提供者*/
class HighlightBlockFoldingProvider {
  constructor(highlightManager) {
    this.highlightManager = highlightManager;
  }

  provideFoldingRanges(document, context, token) {
    // 检查是否启用折叠功能
    const config = vscode.workspace.getConfiguration("highlightBlock");
    if (!config.get("enableFolding", true)) {
      return undefined; // 返回undefined让其他折叠提供者处理
    }

    const allFoldingRanges = [];

    const provideDefault = config.get("provideDefaultFolding", false);
    console.log(`provideDefaultFolding 配置: ${provideDefault}`);
    if (provideDefault) {
      // 1. 添加基于正则表达式的通用折叠检测
      const text = document.getText();
      const lines = text.split("\n");

      // ⭐️ 基于正则表达式的折叠检测
      const regexRanges = this.getRegexBasedFolding(lines);
      allFoldingRanges.push(...regexRanges);

      // ⭐️ 基于缩进的折叠检测（适用于Python等）
      const indentRanges = this.getIndentBasedFolding(lines);
      allFoldingRanges.push(...indentRanges);

      // ⭐️ 基于#region/#endregion的折叠
      const regionRanges = this.getRegionBasedFolding(lines);
      allFoldingRanges.push(...regionRanges);
    }

    // 2. 添加高亮块折叠
    const highlightRanges = this.getHighlightBlockFoldingRanges(document);
    if (highlightRanges && highlightRanges.length > 0) {
      allFoldingRanges.push(...highlightRanges);
    }

    return allFoldingRanges.length > 0 ? allFoldingRanges : undefined;
  }

  /** 移除代码块末尾的空白行*/
  trimTrailingEmptyLines(lines, endLine) {
    // 从结束行开始向前查找，跳过所有空白行
    for (let i = endLine; i >= 0; i--) {
      const line = lines[i];
      if (line.trim() !== '') {
        return i;
      }
    }
    return endLine;
  }

  /** 基于正则表达式的通用折叠检测*/
  getRegexBasedFolding(lines) {
    const foldingRanges = [];
    const text = lines.join('\n');
    
    // 使用正则表达式匹配各种代码块
    const regex = /""".*?"""|\/\*.*?\*\/| *#[^\n]*(?:\r?\n *#[^\n]*)+| *\/\/[^\n]*(?:\r?\n *\/\/[^\n]*)+/gs;
    
    let match;
    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0];
      const startPos = match.index;
      const endPos = startPos + matchedText.length;
      
      // 计算开始和结束行号
      const startLine = text.substring(0, startPos).split('\n').length - 1;
      const endLine = text.substring(0, endPos).split('\n').length - 1;
      
      // 确保至少有2行才进行折叠
      if (endLine > startLine + 1) {
        // 根据匹配类型确定折叠类型
        let foldingKind = vscode.FoldingRangeKind.Region;
        
        if (matchedText.includes('/*') || matchedText.includes('//') || matchedText.includes('#')) {
          foldingKind = vscode.FoldingRangeKind.Comment;
        }
        
        // 去除末尾的空白行
        const trimmedEndLine = this.trimTrailingEmptyLines(lines, endLine);
        if (trimmedEndLine > startLine) {
          foldingRanges.push(new vscode.FoldingRange(startLine, trimmedEndLine, foldingKind));
        }
      }
    }
    
    return foldingRanges;
  }

  /** 获取基于缩进的折叠范围*/  
  getIndentBasedFolding(lines) {
    const foldingRanges = [];
    const indentStack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.trim() === "") continue; // 跳过空行

      const indent = line.search(/\S/); // 找到第一个非空白字符的位置
      if (indent === -1) continue; // 跳过只有空白字符的行

      // 处理缩进减少的情况
      while (indentStack.length > 0 && indentStack[indentStack.length - 1].indent >= indent) {
        const indentInfo = indentStack.pop();
        // 检查缩进块是否包含多行代码
        let hasMultipleLines = false;
        let lastContentLine = indentInfo.line; // 记录最后一个非空行的位置
        
        // 从缩进开始处查找最后一个非空行
        for (let lineIdx = indentInfo.line + 1; lineIdx <= i - 1; lineIdx++) {
          if (lines[lineIdx].trim() !== "") {
            hasMultipleLines = true;
            lastContentLine = lineIdx; // 更新最后一个非空行的位置
          }
        }
        
        // 只有当有多行代码时才创建折叠范围，且只折叠到最后的非空行
        if (hasMultipleLines && lastContentLine > indentInfo.line) {
          foldingRanges.push(new vscode.FoldingRange(indentInfo.line, lastContentLine, vscode.FoldingRangeKind.Region));
        }
      }

      indentStack.push({line: i, indent: indent});
    }

    // 处理剩余的缩进
    while (indentStack.length > 0) {
      const indentInfo = indentStack.pop();
      // 检查缩进块是否包含多行代码
      let hasMultipleLines = false;
      let lastContentLine = indentInfo.line; // 记录最后一个非空行的位置
      
      // 从缩进开始处查找最后一个非空行
      for (let lineIdx = indentInfo.line + 1; lineIdx < lines.length; lineIdx++) {
        if (lines[lineIdx].trim() !== "") {
          hasMultipleLines = true;
          lastContentLine = lineIdx; // 更新最后一个非空行的位置
        }
      }
      
      // 只有当有多行代码时才创建折叠范围，且只折叠到最后的非空行
      if (hasMultipleLines && lastContentLine > indentInfo.line) {
        foldingRanges.push(new vscode.FoldingRange(indentInfo.line, lastContentLine, vscode.FoldingRangeKind.Region));
      }
    }

    return foldingRanges;
  }

  /** 获取基于#region的折叠范围*/ 
  getRegionBasedFolding(lines) {
    const foldingRanges = [];
    const regionStack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // 检查#region
      if (trimmedLine.includes("#region") || trimmedLine.includes("// #region")) {
        regionStack.push(i);
      }
      // 检查#endregion
      else if (trimmedLine.includes("#endregion") || trimmedLine.includes("// #endregion")) {
        if (regionStack.length > 0) {
          const startLine = regionStack.pop();
          if (i > startLine) {
            foldingRanges.push(new vscode.FoldingRange(startLine, i, vscode.FoldingRangeKind.Region));
          }
        }
      }
    }

    return foldingRanges;
  }

  /** 获取基于高亮块的折叠范围*/
  getHighlightBlockFoldingRanges(document) {
    const colorMappings = this.highlightManager.getColorMappings();
    const text = document.getText();

    // 快速检查文档中是否包含任何高亮标记
    let hasHighlightMarkers = false;
    Object.keys(colorMappings).forEach((marker) => {
      if (text.includes(`${marker}-start`) || text.includes(`${marker}-end`)) {
        hasHighlightMarkers = true;
      }
    });

    if (!hasHighlightMarkers) {
      return [];
    }

    const foldingRanges = [];
    const lines = text.split("\n");
    const currentBlocks = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      Object.keys(colorMappings).forEach((marker) => {
        const startMarker = `${marker}-start`;
        const endMarker = `${marker}-end`;

        if (this.highlightManager.containsMarker(trimmedLine, startMarker)) {
          currentBlocks[marker] = {
            startLine: i,
            endLine: null,
          };
        } else if (this.highlightManager.containsMarker(trimmedLine, endMarker)) {
          if (currentBlocks[marker]) {
            const startLine = currentBlocks[marker].startLine;
            let endLine = i;

            // 向前查找，确保不包含末尾的空行
            while (endLine > startLine) {
              const line = lines[endLine];
              if (line.trim() !== "") {
                break;
              }
              endLine--;
            }

            // start-end标记之间的内容始终可以折叠
            if (endLine > startLine) {
              foldingRanges.push(new vscode.FoldingRange(startLine, endLine, vscode.FoldingRangeKind.Region));
            }

            currentBlocks[marker] = null;
          }
        }
      });
    }

    return foldingRanges;
  }
}

/**高亮块管理器*/
class HighlightBlockManager {
  constructor() {
    // tip-start
    this.decorationTypes = new Map(); // 存储不同标记对应的装饰类型
    // tip-end

    // info-start
    this.activeDecorations = new Map(); // 存储每个编辑器的装饰
    // info-end

    // warn-start
    this.disposables = [];
    // warn-end

    // error-start
    this.initializeDecorationTypes();
    // error-end
  }

  /** 初始化装饰类型*/
  initializeDecorationTypes() {
    // 清理现有装饰类型
    this.decorationTypes.forEach((decorationType) => {
      decorationType.dispose();
    });
    this.decorationTypes.clear();

    const config = vscode.workspace.getConfiguration("highlightBlock");
    const colorMappings = this.getColorMappings();

    // 为每个标记创建装饰类型
    Object.entries(colorMappings).forEach(([marker, color]) => {
      const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: color,
        isWholeLine: true,
      });
      this.decorationTypes.set(marker, decorationType);
    });
  }

  /** 获取配置的颜色映射*/
  getColorMappings() {
    const config = vscode.workspace.getConfiguration("highlightBlock");
    return config.get("colorMappings", {});
  }

  /** 查找高亮块*/
  findHighlightBlocks(document) {
    const colorMappings = this.getColorMappings();
    const allBlocks = {};

    // 初始化每个标记的块数组
    Object.keys(colorMappings).forEach((marker) => {
      allBlocks[marker] = [];
    });

    const text = document.getText();
    const lines = text.split("\n");

    // 跟踪每个标记的当前块
    const currentBlocks = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // 检查每个配置的标记
      Object.keys(colorMappings).forEach((marker) => {
        const startMarker = `${marker}-start`;
        const endMarker = `${marker}-end`;

        // 检查开始标记 (只识别 marker-start)
        if (this.containsMarker(trimmedLine, startMarker)) {
          // 如果已经有未结束的同类型块，丢弃它（不渲染不完整的块）
          currentBlocks[marker] = {
            startLine: i,
            endLine: null,
          };
        }
        // 检查结束标记 (marker-end)
        else if (this.containsMarker(trimmedLine, endMarker)) {
          if (currentBlocks[marker]) {
            currentBlocks[marker].endLine = i;
            allBlocks[marker].push(currentBlocks[marker]);
            currentBlocks[marker] = null;
          }
        }
      });
    }

    // 不处理未结束的块，只渲染完整的 start-end 对
    // 未结束的块会被丢弃，不进行渲染

    return allBlocks;
  }

  /** 检查行是否包含标记（严格匹配）*/
  containsMarker(line, marker) {
    // 支持注释中的标记
    const commentPatterns = [
      `//.*${marker}`, // 单行注释
      `#.*${marker}`, // Python 注释
      `/\\*.*${marker}.*\\*/`, // 块注释
      `<!--.*${marker}.*-->`, // HTML 注释
      `".*${marker}.*"`, // 字符串中
      `'.*${marker}.*'`, // 字符串中
    ];

    // 检查是否在注释或字符串中包含标记
    for (const pattern of commentPatterns) {
      if (new RegExp(pattern).test(line)) {
        return true;
      }
    }

    // 直接文本匹配
    return line.includes(marker);
  }

  /** 应用高亮*/
  applyHighlight(editor) {
    if (!editor) {
      return;
    }

    const document = editor.document;
    const allBlocks = this.findHighlightBlocks(document);

    // 清除现有装饰
    this.clearHighlight(editor);

    // 应用新装饰
    const editorDecorations = {};

    Object.entries(allBlocks).forEach(([marker, blocks]) => {
      const decorationType = this.decorationTypes.get(marker);
      if (!decorationType || blocks.length === 0) {
        return;
      }

      const ranges = [];
      blocks.forEach((block) => {
        for (let i = block.startLine; i <= block.endLine; i++) {
          const line = document.lineAt(i);
          ranges.push(line.range);
        }
      });

      if (ranges.length > 0) {
        editor.setDecorations(decorationType, ranges);
        editorDecorations[marker] = ranges;
      }
    });

    this.activeDecorations.set(editor, editorDecorations);
  }

  /** 清除指定编辑器的高亮*/
  clearHighlight(editor) {
    if (!editor) {
      return;
    }

    // 清除所有装饰类型的装饰
    this.decorationTypes.forEach((decorationType) => {
      editor.setDecorations(decorationType, []);
    });

    this.activeDecorations.delete(editor);
  }

  /** 清除所有高亮*/
  clearAllHighlights() {
    vscode.window.visibleTextEditors.forEach((editor) => {
      this.clearHighlight(editor);
    });
  }

  /** 更新所有编辑器的高亮*/
  updateAllHighlights() {
    vscode.window.visibleTextEditors.forEach((editor) => {
      this.applyHighlight(editor);
    });
  }

  /** 重新初始化（配置更改时调用）*/
  reinitialize() {
    this.clearAllHighlights();
    this.initializeDecorationTypes();

    const config = vscode.workspace.getConfiguration("highlightBlock");
    if (config.get("autoHighlight", true)) {
      this.updateAllHighlights();
    }
  }

  /** 获取当前配置的标记列表*/
  getAvailableMarkers() {
    const colorMappings = this.getColorMappings();
    return Object.keys(colorMappings);
  }

  /** 销毁管理器*/
  dispose() {
    this.clearAllHighlights();
    this.decorationTypes.forEach((decorationType) => {
      decorationType.dispose();
    });
    this.decorationTypes.clear();
    this.disposables.forEach((d) => d.dispose());
    this.activeDecorations.clear();
  }
}

let highlightManager;
let foldingProvider;

/**插件激活函数*/
function activate(context) {
  console.log("Highlight Block 插件已激活");

  highlightManager = new HighlightBlockManager();
  foldingProvider = new HighlightBlockFoldingProvider(highlightManager);

  // 注册命令：切换高亮
  const toggleCommand = vscode.commands.registerCommand("highlight-block.toggle", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("没有活动的编辑器");
      return;
    }

    const hasDecorations = highlightManager.activeDecorations.has(editor);
    if (hasDecorations) {
      highlightManager.clearHighlight(editor);
      vscode.window.showInformationMessage("已清除当前编辑器的高亮");
    } else {
      highlightManager.applyHighlight(editor);
      vscode.window.showInformationMessage("已应用高亮");
    }
  });

  // 注册命令：清除所有高亮
  const clearCommand = vscode.commands.registerCommand("highlight-block.clear", () => {
    highlightManager.clearAllHighlights();
    vscode.window.showInformationMessage("已清除所有高亮");
  });

  // 注册命令：显示可用标记
  const showMarkersCommand = vscode.commands.registerCommand("highlight-block.showMarkers", () => {
    const markers = highlightManager.getAvailableMarkers();
    const markersText = markers.join(", ");
    vscode.window.showInformationMessage(`可用标记: ${markersText}`);
  });

  // 监听编辑器切换
  const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      const config = vscode.workspace.getConfiguration("highlightBlock");
      if (config.get("autoHighlight", true)) {
        highlightManager.applyHighlight(editor);
      }
    }
  });

  // 监听文档内容变化
  const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document === event.document) {
      const config = vscode.workspace.getConfiguration("highlightBlock");
      if (config.get("autoHighlight", true)) {
        // 延迟更新以避免频繁刷新
        setTimeout(() => {
          highlightManager.applyHighlight(editor);
        }, 200);
      }
    }
  });

  // 监听配置变化
  const onDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("highlightBlock")) {
      highlightManager.reinitialize();
      vscode.window.showInformationMessage("高亮块配置已更新");
    }
  });

  // 监听编辑器可见性变化
  const onDidChangeVisibleTextEditors = vscode.window.onDidChangeVisibleTextEditors((editors) => {
    const config = vscode.workspace.getConfiguration("highlightBlock");
    if (config.get("autoHighlight", true)) {
      editors.forEach((editor) => {
        highlightManager.applyHighlight(editor);
      });
    }
  });

  // 注册折叠范围提供者（使用更具体的选择器以减少干扰）
  const foldingProviderRegistration = vscode.languages.registerFoldingRangeProvider(
    [{scheme: "file"}, {scheme: "untitled"}],
    foldingProvider
  );

  // 添加到订阅列表
  context.subscriptions.push(
    toggleCommand,
    clearCommand,
    showMarkersCommand,
    onDidChangeActiveTextEditor,
    onDidChangeTextDocument,
    onDidChangeConfiguration,
    onDidChangeVisibleTextEditors,
    foldingProviderRegistration,
    highlightManager
  );

  // 初始化当前编辑器的高亮
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const config = vscode.workspace.getConfiguration("highlightBlock");
    if (config.get("autoHighlight", true)) {
      highlightManager.applyHighlight(activeEditor);
    }
  }
}

/**插件停用函数*/
function deactivate() {
  if (highlightManager) {
    highlightManager.dispose();
  }
  console.log("Highlight Block 插件已停用");
}

module.exports = {
  activate,
  deactivate,
};
