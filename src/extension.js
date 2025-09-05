const vscode = require("vscode");
const {SyntaxFoldingProvider} = require("./syntaxFoldingProvider");

/**折叠范围提供者*/
class HighlightBlockFoldingProvider {
  constructor(highlightManager) {
    this.highlightManager = highlightManager;
    this.syntaxProvider = new SyntaxFoldingProvider();
  }

  async provideFoldingRanges(document, context, token) {
    // 检查是否启用折叠功能
    const config = vscode.workspace.getConfiguration("highlightBlock");

    const allFoldingRanges = [];

    const enableSyntaxFolding = config.get("enableSyntaxFolding", true);
    const enableRegexFolding = config.get("enableRegexFolding", true);
    const enableIndentFolding = config.get("enableIndentFolding", true);
    const supportedLanguages = config.get("syntaxFoldingLanguages", []);

    console.log(`enableSyntaxFolding 配置: ${enableSyntaxFolding}`);

    // ⭐️ 添加高亮块折叠（总是启用）
    const highlightRanges = this.getHighlightBlockFoldingRanges(document);
    if (highlightRanges && highlightRanges.length > 0) {
      allFoldingRanges.push(...highlightRanges);
    }

    // ⭐️ 基于语法解析的折叠检测（tree-sitter）
    if (enableSyntaxFolding) {
      const languageId = document.languageId;
      const fileName = document.fileName;
      const extension = fileName.split(".").pop()?.toLowerCase();

      // 检查当前语言是否在支持列表中
      const isLanguageSupported =
        supportedLanguages.includes(languageId) ||
        supportedLanguages.some((lang) => {
          // 检查文件扩展名是否匹配
          const langExtensions = this.getLanguageExtensions(lang);
          return langExtensions.includes(extension);
        });

      if (isLanguageSupported) {
        try {
          const syntaxRanges = await this.syntaxProvider.provideSyntaxFoldingRanges(document);
          if (syntaxRanges && syntaxRanges.length > 0) {
            allFoldingRanges.push(...syntaxRanges);
            console.log(`添加 ${syntaxRanges.length} 个语法折叠范围 for ${languageId}`);
          }
        } catch (error) {
          console.warn('获取语法折叠范围失败:', error);
        }
      }
    }

    // ⭐️ 基于正则表达式的折叠检测
    if (enableRegexFolding) {
      const text = document.getText();
      const lines = text.split("\n");
      const regexRanges = this.getRegexBasedFolding(lines);
      allFoldingRanges.push(...regexRanges);

      // ⭐️ 基于#region/#endregion的折叠
      const regionRanges = this.getRegionBasedFolding(lines);
      allFoldingRanges.push(...regionRanges);
    }

    // ⭐️ 基于缩进的折叠检测
    if (enableIndentFolding) {
      const text = document.getText();
      const lines = text.split("\n");
      const indentRanges = this.getIndentBasedFolding(lines);
      if (indentRanges && indentRanges.length > 0) {
        allFoldingRanges.push(...indentRanges);
      }
    }

    // 只有当有我们自己的折叠范围时才返回，否则返回空数组
    // 这样可以确保不干扰其他折叠提供者（如Pylance）
    return allFoldingRanges.length > 0 ? allFoldingRanges : null;
  }

  /** 获取语言对应的文件扩展名*/
  getLanguageExtensions(languageId) {
    const extensionMap = {
      javascript: ["js", "jsx", "mjs"],
      typescript: ["ts", "tsx"],
      python: ["py", "pyw"],
      java: ["java"],
      json: ["json"],
    };
    return extensionMap[languageId] || [];
  }

  /** 移除代码块末尾的空白行*/
  trimTrailingEmptyLines(lines, endLine) {
    // 从结束行开始向前查找，跳过所有空白行
    for (let i = endLine; i >= 0; i--) {
      const line = lines[i];
      if (line.trim() !== "") {
        return i;
      }
    }
    return endLine;
  }

  /** 找到折叠块的实际起始行，确保不包含无关的前置行*/
  findActualStartLine(lines, calculatedStartLine, matchedText) {
    // 对于多行字符串，确保折叠从包含开始标记的行开始
    const line = lines[calculatedStartLine];
    if (!line) return calculatedStartLine;

    // 检查这一行是否真的包含匹配内容的开始部分
    const firstLineOfMatch = matchedText.split("\n")[0];

    // 如果当前行包含匹配内容的开始，就使用当前行
    if (line.includes(firstLineOfMatch) || line.includes('"""') || line.includes("'''")) {
      return calculatedStartLine;
    }

    // 否则，向下查找真正的起始行
    for (let i = calculatedStartLine; i < lines.length; i++) {
      const currentLine = lines[i];
      if (currentLine && (currentLine.includes(firstLineOfMatch) || currentLine.includes('"""') || currentLine.includes("'''"))) {
        return i;
      }
    }

    return calculatedStartLine;
  }

  /** 调整缩进折叠的起始行，避免包含单独的注释行*/
  adjustStartLineForIndentFolding(lines, startLine, endLine) {
    const startLineContent = lines[startLine];
    if (!startLineContent) return startLine;

    // 计算折叠范围的大小
    const foldSize = endLine - startLine;

    // 如果折叠范围很小（<=3行），需要更严格的检查
    if (foldSize <= 3) {
      // 检查是否主要是注释行
      let commentLineCount = 0;
      let codeLineCount = 0;

      for (let i = startLine; i <= endLine; i++) {
        const line = lines[i];
        if (line && line.trim() !== "") {
          if (line.trim().startsWith("#")) {
            commentLineCount++;
          } else {
            codeLineCount++;
          }
        }
      }

      // 如果小范围折叠中注释行占主导，跳过这个折叠
      if (commentLineCount >= codeLineCount && foldSize <= 3) {
        return endLine; // 返回一个无效的起始位置，使折叠被跳过
      }
    }

    // 如果起始行是单独的注释行，检查下一行是否是更合适的起始位置
    if (startLineContent.trim().startsWith("#")) {
      // 查找下一个非空、非注释的行作为真正的折叠起始行
      for (let i = startLine + 1; i < endLine; i++) {
        const line = lines[i];
        if (line && line.trim() !== "" && !line.trim().startsWith("#")) {
          // 确保这一行确实有足够的内容值得折叠
          // 并且后面还有其他行
          if (i < endLine - 1) {
            return i;
          }
        }
      }
    }

    return startLine;
  }

  /** 基于正则表达式的通用折叠检测*/
  getRegexBasedFolding(lines) {
    const foldingRanges = [];
    const text = lines.join("\n");

    // 处理双引号多行字符串折叠
    this.addFoldingRangesForRegex(text, lines, foldingRanges, /"""(?:[^"\\]|\\.|"(?!""))*"""/gs, vscode.FoldingRangeKind.Region);

    // 处理单引号多行字符串折叠
    this.addFoldingRangesForRegex(text, lines, foldingRanges, /'''(?:[^'\\]|\\.|'(?!''))*'''/gs, vscode.FoldingRangeKind.Region);

    // 处理多行注释折叠
    this.addFoldingRangesForRegex(text, lines, foldingRanges, /\/\*[\s\S]*?\*\//gs, vscode.FoldingRangeKind.Comment);

    // 处理Python风格的多行注释折叠 (只有连续的3行或以上注释才折叠)
    this.addFoldingRangesForRegex(text, lines, foldingRanges, / *#[^\n]*(?:\r?\n *#[^\n]*){2,}/gs, vscode.FoldingRangeKind.Comment);

    // 处理多行单行注释折叠
    this.addFoldingRangesForRegex(text, lines, foldingRanges, / *\/\/[^\n]*(?:\r?\n *\/\/[^\n]*)+/gs, vscode.FoldingRangeKind.Comment);

    return foldingRanges;
  }

  /** 检查指定行是否在多行字符串内部*/
  isInsideMultiLineString(lines, lineIndex) {
    let inMultiLineString = false;
    for (let i = 0; i < lineIndex; i++) {
      const line = lines[i];
      if (/^\s*(\w+\s*=\s*)?"""/.test(line) && !inMultiLineString) {
        inMultiLineString = true;
      } else if (line.trim().endsWith('"""') && inMultiLineString) {
        inMultiLineString = false;
      }
    }
    return inMultiLineString;
  }

  /** 为指定正则表达式添加折叠范围*/
  addFoldingRangesForRegex(text, lines, foldingRanges, regex, foldingKind) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0];
      const startPos = match.index;
      const endPos = startPos + matchedText.length;

      // 计算开始和结束行号
      const startLine = text.substring(0, startPos).split("\n").length - 1;
      const endLine = text.substring(0, endPos).split("\n").length - 1;

      // 确保至少有2行才进行折叠
      if (endLine > startLine + 1) {
        // 去除末尾的空白行
        const trimmedEndLine = this.trimTrailingEmptyLines(lines, endLine);
        if (trimmedEndLine > startLine) {
          // 检查折叠块的确切起始位置，确保不包含无关的前置行
          const actualStartLine = this.findActualStartLine(lines, startLine, matchedText);
          foldingRanges.push(new vscode.FoldingRange(actualStartLine, trimmedEndLine, foldingKind));
        }
      }
    }
  }

  /** 获取基于缩进的折叠范围*/
  getIndentBasedFolding(lines) {
    const foldingRanges = [];
    const indentStack = [];
    const multiLineStringStack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim() === "") continue; // 跳过空行

      // 更准确的多行字符串检测
      const tripleQuoteCount = (line.match(/"""/g) || []).length;
      const singleTripleQuoteCount = (line.match(/'''/g) || []).length;

      // 检查是否遇到多行字符串开始
      const isMultiLineStringStart =
        (tripleQuoteCount > 0 && multiLineStringStack.length === 0 && tripleQuoteCount % 2 === 1) || (singleTripleQuoteCount > 0 && multiLineStringStack.length === 0 && singleTripleQuoteCount % 2 === 1);

      // 如果遇到多行字符串开始，但不要过早结束函数或类的折叠
      // 只有当多行字符串不是在函数/类定义行的下一行时才处理缩进块
      if (isMultiLineStringStart) {
        // 检查前面几行是否是函数或类定义（考虑可能有空行）
        let isPrevLineStructureDefinition = false;
        for (let checkIdx = i - 1; checkIdx >= Math.max(0, i - 3); checkIdx--) {
          const checkLine = lines[checkIdx];
          if (checkLine && checkLine.trim() !== "") {
            isPrevLineStructureDefinition = /^\s*(def |class |if |for |while |try:|except|finally:|with |async def |elif |else:)/.test(checkLine);
            break; // 找到第一个非空行就停止检查
          }
        }

        // 如果多行字符串紧跟在结构定义后面（通常是文档字符串），不要处理缩进块
        if (!isPrevLineStructureDefinition) {
          // 处理所有当前的缩进块，确保它们在多行字符串开始前结束
          while (indentStack.length > 0) {
            const indentInfo = indentStack.pop();

            // 检查缩进块是否包含多行代码
            let hasMultipleLines = false;
            let lastContentLine = indentInfo.line; // 记录最后一个非空行的位置
            let contentLineCount = 0; // 统计非空行数量

            // 从缩进开始处查找最后一个非空行（但不包括当前的多行字符串开始行）
            for (let lineIdx = indentInfo.line + 1; lineIdx < i; lineIdx++) {
              const currentLine = lines[lineIdx];

              if (currentLine.trim() !== "") {
                hasMultipleLines = true;
                lastContentLine = lineIdx; // 更新最后一个非空行的位置
                contentLineCount++;
              }
            }

            // 检查起始行是否是重要结构
            const startLineContent = lines[indentInfo.line];
            const isImportantStructure =
              startLineContent && (/^\s*(def |class |if |for |while |try:|except|finally:|with |async def |elif |else:)/.test(startLineContent) || /^\s*if __name__ == ['""]__main__['""]/.test(startLineContent));

            const shouldCreateFold = hasMultipleLines || isImportantStructure;

            if (shouldCreateFold && lastContentLine > indentInfo.line) {
              // 检查起始行是否是单独的注释行，如果是则跳过或调整起始位置
              const actualStartLine = this.adjustStartLineForIndentFolding(lines, indentInfo.line, lastContentLine);
              if (actualStartLine < lastContentLine) {
                // 额外检查：避免创建过小的折叠范围
                const foldSize = lastContentLine - actualStartLine;
                // 对于重要结构，放宽折叠要求
                const minFoldSize = isImportantStructure ? 0 : 1;
                if (foldSize >= minFoldSize) {
                  foldingRanges.push(new vscode.FoldingRange(actualStartLine, lastContentLine, vscode.FoldingRangeKind.Region));
                }
              }
            }
          }
        }
      }

      // 处理双引号多行字符串
      if (tripleQuoteCount > 0) {
        if (multiLineStringStack.length === 0) {
          // 如果这一行只有开始标记（奇数个三引号），开始多行字符串
          if (tripleQuoteCount % 2 === 1) {
            multiLineStringStack.push(i);
            continue;
          }
        } else {
          // 如果在多行字符串中遇到结束标记
          if (tripleQuoteCount % 2 === 1) {
            multiLineStringStack.pop();
            continue;
          }
        }
      }

      // 处理单引号多行字符串
      if (singleTripleQuoteCount > 0) {
        if (multiLineStringStack.length === 0) {
          if (singleTripleQuoteCount % 2 === 1) {
            multiLineStringStack.push(i);
            continue;
          }
        } else {
          if (singleTripleQuoteCount % 2 === 1) {
            multiLineStringStack.pop();
            continue;
          }
        }
      }

      if (multiLineStringStack.length > 0) continue; // 跳过多行字符串内部

      const indent = line.search(/\S/); // 找到第一个非空白字符的位置
      if (indent === -1) continue; // 跳过只有空白字符的行

      // 处理缩进减少的情况
      while (indentStack.length > 0 && indentStack[indentStack.length - 1].indent >= indent) {
        const indentInfo = indentStack.pop();

        // 检查缩进块是否包含多行代码
        let hasMultipleLines = false;
        let lastContentLine = indentInfo.line; // 记录最后一个非空行的位置
        let contentLineCount = 0; // 统计非空行数量

        // 从缩进开始处查找最后一个非空行
        for (let lineIdx = indentInfo.line + 1; lineIdx <= i - 1; lineIdx++) {
          const currentLine = lines[lineIdx];

          if (currentLine.trim() !== "") {
            hasMultipleLines = true;
            lastContentLine = lineIdx; // 更新最后一个非空行的位置
            contentLineCount++;
          }
        }

        // 创建折叠范围的条件：
        // 1. 缩进确实减少了，或者
        // 2. 缩进相同但有多行代码且至少有1行内容
        const shouldCreateFold = indentInfo.indent > indent || (indentInfo.indent === indent && hasMultipleLines && contentLineCount >= 1);

        // 检查起始行是否是函数定义、类定义、条件语句等值得折叠的结构
        const startLineContent = lines[indentInfo.line];
        const isImportantStructure =
          startLineContent && (/^\s*(def |class |if |for |while |try:|except|finally:|with |async def |elif |else:)/.test(startLineContent) || /^\s*if __name__ == ['""]__main__['""]/.test(startLineContent));

        if ((shouldCreateFold || isImportantStructure) && lastContentLine > indentInfo.line) {
          // 检查起始行是否是单独的注释行，如果是则跳过或调整起始位置
          const actualStartLine = this.adjustStartLineForIndentFolding(lines, indentInfo.line, lastContentLine);
          if (actualStartLine < lastContentLine) {
            // 额外检查：避免创建过小的折叠范围
            const foldSize = lastContentLine - actualStartLine;
            // 对于重要结构，放宽折叠要求
            const minFoldSize = isImportantStructure ? 0 : 1;
            if (foldSize >= minFoldSize) {
              foldingRanges.push(new vscode.FoldingRange(actualStartLine, lastContentLine, vscode.FoldingRangeKind.Region));
            }
          }
        }

        // 如果缩进相同，跳出循环
        if (indentInfo.indent === indent) {
          break;
        }
      }

      indentStack.push({line: i, indent: indent});
    }

    // 如果文件末尾有未闭合的缩进块，则处理剩余的缩进
    while (indentStack.length > 0) {
      const indentInfo = indentStack.pop();
      // 检查缩进块是否包含多行代码
      let hasMultipleLines = false;
      let lastContentLine = indentInfo.line; // 记录最后一个非空行的位置
      let contentLineCount = 0; // 统计非空行数量

      // 从缩进开始处查找最后一个非空行
      for (let lineIdx = indentInfo.line + 1; lineIdx < lines.length; lineIdx++) {
        if (lines[lineIdx].trim() !== "") {
          hasMultipleLines = true;
          lastContentLine = lineIdx; // 更新最后一个非空行的位置
          contentLineCount++;
        }
      }

      // 检查起始行是否是重要结构
      const startLineContent = lines[indentInfo.line];
      const isImportantStructure =
        startLineContent && (/^\s*(def |class |if |for |while |try:|except|finally:|with |async def |elif |else:)/.test(startLineContent) || /^\s*if __name__ == ['""]__main__['""]/.test(startLineContent));

      // 创建折叠的条件
      const shouldCreateEndFold = (hasMultipleLines && contentLineCount >= 1) || isImportantStructure;

      if (shouldCreateEndFold && lastContentLine > indentInfo.line) {
        // 检查起始行是否是单独的注释行，如果是则跳过或调整起始位置
        const actualStartLine = this.adjustStartLineForIndentFolding(lines, indentInfo.line, lastContentLine);
        if (actualStartLine < lastContentLine) {
          // 额外检查：避免创建过小的折叠范围
          const foldSize = lastContentLine - actualStartLine;
          // 对于重要结构，放宽折叠要求
          const minFoldSize = isImportantStructure ? 0 : 1;
          if (foldSize >= minFoldSize) {
            foldingRanges.push(new vscode.FoldingRange(actualStartLine, lastContentLine, vscode.FoldingRangeKind.Region));
          }
        }
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
    this.decorationTypes = new Map(); // 存储不同标记对应的装饰类型
    this.activeDecorations = new Map(); // 存储每个编辑器的装饰
    this.disposables = [];
    this.initializeDecorationTypes();
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

      // 如果折叠相关配置发生变化，重新初始化语法提供者
      if (event.affectsConfiguration("highlightBlock.enableSyntaxFolding") || event.affectsConfiguration("highlightBlock.syntaxFoldingLanguages")) {
        if (foldingProvider && foldingProvider.syntaxProvider) {
          foldingProvider.syntaxProvider.dispose();
          foldingProvider.syntaxProvider = new SyntaxFoldingProvider();
        }
      }

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
  const foldingProviderRegistration = vscode.languages.registerFoldingRangeProvider([{scheme: "file"}, {scheme: "untitled"}], foldingProvider);

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
  if (foldingProvider && foldingProvider.syntaxProvider) {
    foldingProvider.syntaxProvider.dispose();
  }
  console.log("Highlight Block 插件已停用");
}

module.exports = {
  activate,
  deactivate,
};
