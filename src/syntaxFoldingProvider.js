const vscode = require("vscode");
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 基于命令行+正则的轻量级语法折叠提供者
 */
class SyntaxFoldingProvider {
  constructor() {
    this.supportedLanguages = new Set(['python', 'javascript', 'typescript', 'java', 'json']);
    this.initialized = true; // 不需要异步初始化
  }

  /**
   * 检查系统是否有对应的解析器
   */
  async checkSystemParsers() {
    const results = {};
    
    // 检查 Python
    try {
      await this.execCommand('python --version');
      results.python = true;
    } catch {
      try {
        await this.execCommand('python3 --version');
        results.python = true;
      } catch {
        results.python = false;
      }
    }
    
    // 检查 Node.js
    try {
      await this.execCommand('node --version');
      results.node = true;
    } catch {
      results.node = false;
    }
    
    return results;
  }

  /**
   * 执行命令行命令
   */
  execCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
      exec(command, { timeout: 5000, ...options }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  /**
   * 获取语言类型
   */
  getLanguageType(document) {
    const languageId = document.languageId;
    const fileName = document.fileName;
    const extension = fileName.split('.').pop()?.toLowerCase();
    
    // 直接匹配语言ID
    if (this.supportedLanguages.has(languageId)) {
      return languageId;
    }
    
    // 根据文件扩展名匹配
    const extensionMap = {
      'py': 'python',
      'pyw': 'python',
      'js': 'javascript', 
      'jsx': 'javascript',
      'mjs': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'java': 'java',
      'json': 'json'
    };
    
    return extensionMap[extension] || null;
  }

  /**
   * 提供基于语法的折叠范围
   */
  async provideSyntaxFoldingRanges(document) {
    const languageType = this.getLanguageType(document);
    if (!languageType) {
      console.log(`No parser available for language: ${document.languageId}`);
      return [];
    }

    try {
      const text = document.getText();
      const foldingRanges = [];

      console.log(`Parsing ${languageType} document with ${text.split('\n').length} lines`);
      
      // 根据语言类型选择解析方式
      if (languageType === 'python') {
        await this.parsePythonWithAST(text, foldingRanges);
      } else if (languageType === 'javascript' || languageType === 'typescript') {
        await this.parseJavaScriptWithNode(text, foldingRanges);
      } else {
        // 其他语言使用增强的正则表达式
        this.parseWithRegex(text, languageType, foldingRanges);
      }
      
      console.log(`Found ${foldingRanges.length} syntax folding ranges`);
      return foldingRanges;
    } catch (error) {
      console.warn('Error parsing document:', error);
      return [];
    }
  }

  /**
   * 使用Python AST解析Python代码
   */
  async parsePythonWithAST(text, foldingRanges) {
    try {
      // 创建临时文件
      const tempFile = path.join(os.tmpdir(), `vscode_syntax_${Date.now()}.py`);
      fs.writeFileSync(tempFile, text, 'utf8');
      
      // 使用Python AST解析
      const pythonScript = `
import ast
import json
import sys

try:
    with open('${tempFile}', 'r', encoding='utf-8') as f:
        source = f.read()
    
    tree = ast.parse(source)
    ranges = []
    
    for node in ast.walk(tree):
        if hasattr(node, 'lineno') and hasattr(node, 'end_lineno') and node.end_lineno:
            start_line = node.lineno - 1  # 转换为0基索引
            end_line = node.end_lineno - 1
            
            if end_line > start_line:
                node_type = type(node).__name__
                kind = 'region'
                
                if node_type in ['FunctionDef', 'AsyncFunctionDef', 'ClassDef']:
                    kind = 'region'
                elif node_type in ['If', 'For', 'While', 'Try', 'With']:
                    kind = 'region'
                    
                ranges.append({
                    'startLine': start_line,
                    'endLine': end_line,
                    'kind': kind,
                    'type': node_type
                })
    
    print(json.dumps(ranges))
except Exception as e:
    print(json.dumps([]))
`;

      const pythonCmd = await this.getPythonCommand();
      const result = await this.execCommand(`${pythonCmd} -c "${pythonScript.replace(/"/g, '\\"')}"`);
      
      // 清理临时文件
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        // 忽略清理错误
      }
      
      const ranges = JSON.parse(result.stdout.trim());
      ranges.forEach(range => {
        const kind = this.getFoldingKind(range.kind);
        foldingRanges.push(new vscode.FoldingRange(range.startLine, range.endLine, kind));
      });
      
    } catch (error) {
      console.warn('Python AST parsing failed, falling back to regex:', error.message);
      this.parseWithRegex(text, 'python', foldingRanges);
    }
  }

  /**
   * 使用Node.js解析JavaScript/TypeScript代码
   */
  async parseJavaScriptWithNode(text, foldingRanges) {
    try {
      // 创建临时文件
      const tempFile = path.join(os.tmpdir(), `vscode_syntax_${Date.now()}.js`);
      fs.writeFileSync(tempFile, text, 'utf8');
      
      // 简单的语法检查
      const result = await this.execCommand(`node -c "${tempFile}"`);
      
      // 清理临时文件
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        // 忽略清理错误
      }
      
      // 如果语法正确，使用增强的正则表达式解析
      this.parseWithRegex(text, 'javascript', foldingRanges);
      
    } catch (error) {
      console.warn('Node.js parsing failed, falling back to regex:', error.message);
      this.parseWithRegex(text, 'javascript', foldingRanges);
    }
  }

  /**
   * 获取Python命令
   */
  async getPythonCommand() {
    try {
      await this.execCommand('python --version');
      return 'python';
    } catch {
      try {
        await this.execCommand('python3 --version');
        return 'python3';
      } catch {
        throw new Error('Python not found');
      }
    }
  }

  /**
   * 使用增强正则表达式解析代码结构
   */
  parseWithRegex(text, languageType, foldingRanges) {
    const lines = text.split('\n');
    
    if (languageType === 'python') {
      this.parsePythonWithRegex(lines, foldingRanges);
    } else if (languageType === 'javascript' || languageType === 'typescript') {
      this.parseJavaScriptWithRegex(lines, foldingRanges);
    } else if (languageType === 'java') {
      this.parseJavaWithRegex(lines, foldingRanges);
    } else if (languageType === 'json') {
      this.parseJsonWithRegex(lines, foldingRanges);
    }
  }

  /**
   * Python正则解析
   */
  parsePythonWithRegex(lines, foldingRanges) {
    const patterns = {
      function: /^\s*(def\s+\w+.*?:)/,
      asyncFunction: /^\s*(async\s+def\s+\w+.*?:)/,
      class: /^\s*(class\s+\w+.*?:)/,
      ifBlock: /^\s*(if\s+.*?:)/,
      elifBlock: /^\s*(elif\s+.*?:)/,
      elseBlock: /^\s*(else\s*:)/,
      forLoop: /^\s*(for\s+.*?:)/,
      whileLoop: /^\s*(while\s+.*?:)/,
      tryBlock: /^\s*(try\s*:)/,
      exceptBlock: /^\s*(except.*?:)/,
      finallyBlock: /^\s*(finally\s*:)/,
      withBlock: /^\s*(with\s+.*?:)/,
      matchBlock: /^\s*(match\s+.*?:)/,
    };

    this.findBlocksWithIndent(lines, patterns, foldingRanges);
  }

  /**
   * JavaScript/TypeScript正则解析
   */
  parseJavaScriptWithRegex(lines, foldingRanges) {
    const patterns = {
      function: /^\s*(function\s+\w+.*?\{|async\s+function\s+\w+.*?\{)/,
      arrowFunction: /^\s*.*?=>\s*\{/,
      class: /^\s*(class\s+\w+.*?\{)/,
      ifBlock: /^\s*(if\s*\(.*?\)\s*\{)/,
      elseBlock: /^\s*(else\s*\{|else\s+if.*?\{)/,
      forLoop: /^\s*(for\s*\(.*?\)\s*\{)/,
      whileLoop: /^\s*(while\s*\(.*?\)\s*\{)/,
      tryBlock: /^\s*(try\s*\{)/,
      catchBlock: /^\s*(catch\s*\(.*?\)\s*\{)/,
      finallyBlock: /^\s*(finally\s*\{)/,
      switchBlock: /^\s*(switch\s*\(.*?\)\s*\{)/,
    };

    this.findBlocksWithBraces(lines, patterns, foldingRanges);
  }

  /**
   * Java正则解析
   */
  parseJavaWithRegex(lines, foldingRanges) {
    const patterns = {
      class: /^\s*(public\s+|private\s+|protected\s+)*(class\s+\w+.*?\{)/,
      method: /^\s*(public\s+|private\s+|protected\s+|static\s+)*.*?\w+\s*\(.*?\)\s*\{/,
      ifBlock: /^\s*(if\s*\(.*?\)\s*\{)/,
      elseBlock: /^\s*(else\s*\{|else\s+if.*?\{)/,
      forLoop: /^\s*(for\s*\(.*?\)\s*\{)/,
      whileLoop: /^\s*(while\s*\(.*?\)\s*\{)/,
      tryBlock: /^\s*(try\s*\{)/,
      catchBlock: /^\s*(catch\s*\(.*?\)\s*\{)/,
      finallyBlock: /^\s*(finally\s*\{)/,
    };

    this.findBlocksWithBraces(lines, patterns, foldingRanges);
  }

  /**
   * JSON正则解析
   */
  parseJsonWithRegex(lines, foldingRanges) {
    let braceStack = [];
    let bracketStack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 处理对象开始
      if (trimmed.includes('{')) {
        braceStack.push(i);
      }

      // 处理数组开始
      if (trimmed.includes('[')) {
        bracketStack.push(i);
      }

      // 处理对象结束
      if (trimmed.includes('}') && braceStack.length > 0) {
        const startLine = braceStack.pop();
        if (i > startLine) {
          foldingRanges.push(new vscode.FoldingRange(startLine, i, vscode.FoldingRangeKind.Region));
        }
      }

      // 处理数组结束
      if (trimmed.includes(']') && bracketStack.length > 0) {
        const startLine = bracketStack.pop();
        if (i > startLine) {
          foldingRanges.push(new vscode.FoldingRange(startLine, i, vscode.FoldingRangeKind.Region));
        }
      }
    }
  }

  /**
   * 基于缩进查找Python代码块
   */
  findBlocksWithIndent(lines, patterns, foldingRanges) {
    const stack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed === '' || trimmed.startsWith('#')) continue;

      const indent = line.search(/\S/);
      if (indent === -1) continue;

      // 检查是否匹配任何模式
      let matchedPattern = null;
      for (const [patternName, regex] of Object.entries(patterns)) {
        if (regex.test(line)) {
          matchedPattern = patternName;
          break;
        }
      }

      // 处理缩进减少的情况
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        const block = stack.pop();
        const endLine = i - 1;
        if (endLine > block.startLine) {
          foldingRanges.push(new vscode.FoldingRange(block.startLine, endLine, vscode.FoldingRangeKind.Region));
        }
      }

      // 如果匹配到模式，添加到栈中
      if (matchedPattern) {
        stack.push({
          startLine: i,
          indent: indent,
          pattern: matchedPattern
        });
      }
    }

    // 处理文件末尾剩余的块
    while (stack.length > 0) {
      const block = stack.pop();
      const endLine = lines.length - 1;
      if (endLine > block.startLine) {
        foldingRanges.push(new vscode.FoldingRange(block.startLine, endLine, vscode.FoldingRangeKind.Region));
      }
    }
  }

  /**
   * 基于大括号查找JavaScript/Java代码块
   */
  findBlocksWithBraces(lines, patterns, foldingRanges) {
    const stack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

      // 检查是否匹配任何模式
      let matchedPattern = null;
      for (const [patternName, regex] of Object.entries(patterns)) {
        if (regex.test(line)) {
          matchedPattern = patternName;
          break;
        }
      }

      if (matchedPattern) {
        stack.push({
          startLine: i,
          pattern: matchedPattern,
          braceCount: 0
        });
      }

      // 计算大括号
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;

      // 更新栈中所有块的大括号计数
      for (const block of stack) {
        block.braceCount += openBraces - closeBraces;
      }

      // 检查是否有块结束
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j].braceCount === 0 && i > stack[j].startLine) {
          const block = stack.splice(j, 1)[0];
          foldingRanges.push(new vscode.FoldingRange(block.startLine, i, vscode.FoldingRangeKind.Region));
        }
      }
    }
  }

  /**
   * 获取折叠类型
   */
  getFoldingKind(kind) {
    switch (kind) {
      case 'comment':
        return vscode.FoldingRangeKind.Comment;
      case 'imports':
        return vscode.FoldingRangeKind.Imports;
      case 'region':
      default:
        return vscode.FoldingRangeKind.Region;
    }
  }

  /**
   * 检查解析器是否可用
   */
  isAvailable() {
    return this.initialized;
  }

  /**
   * 异步检查解析器是否可用
   */
  async isAvailableAsync() {
    return this.isAvailable();
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages() {
    return Array.from(this.supportedLanguages);
  }

  /**
   * 释放资源
   */
  dispose() {
    // 轻量级实现，无需特殊清理
  }
}

module.exports = { SyntaxFoldingProvider };