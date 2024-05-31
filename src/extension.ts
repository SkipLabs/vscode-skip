import * as vscode from "vscode";
import * as which from "which";
import { execSync } from "child_process";

function formatSkipFile(fileName: string, fileContents: string): string {
  const skfmt = which.sync("skfmt");
  const command = `"${skfmt}" --assume-filename "${fileName}"`;
  console.log(command);
  return execSync(command, { encoding: "utf8", input: fileContents });
}

const documentFormattingEditProvider = {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
  ): vscode.TextEdit[] {
    const fullText = document.getText();
    const invalidRange = new vscode.Range(0, 0, document.lineCount, 0);
    const fullRange = document.validateRange(invalidRange);
    try {
      const newText = formatSkipFile(document.fileName, fullText);

      return [vscode.TextEdit.replace(fullRange, newText)];
    } catch (error) {
      const info =
        error instanceof Error && "stderr" in error ? error.stderr : error;
      vscode.window.showErrorMessage(`Skip: cannot format.\n${info}`);
      return [];
    }
  },
};

const documentSymbolProvider = {
  provideDocumentSymbols(
    document: vscode.TextDocument,
  ): vscode.SymbolInformation[] {
    const symbolRE = /(?:\b(?<kind1>class|const|fun|module|trait|type)\s+\.?(?<name1>\w+)|(?<kind2>\|)\s*\.?(?<name2>\w+)\s*\((?!.+->))/dg;

    const results = [];
    let currentModule = undefined;
    let currentClass = undefined;

    for (const match of document.getText().matchAll(symbolRE)) {
      const groups = match.groups;
      const indices = match.indices?.groups;
      if (groups === undefined || indices === undefined) {
        continue;
      }

      const rawKind = groups['kind1'] ?? groups['kind2'];
      const name = groups['name1'] ?? groups['name2'];
      const nameIndices = indices['name1'] ?? indices['name2'];
      if (rawKind === 'module' && name === 'end') {
        currentModule = undefined;
        currentClass = undefined;
        continue;
      }

      if (name === undefined || nameIndices === undefined) {
        continue;
      }

      const kind = (rawKind === 'class' || rawKind === '|') ? vscode.SymbolKind.Class :
        rawKind === 'const' ? vscode.SymbolKind.Constant :
          rawKind === 'fun' ? (currentClass !== undefined ? vscode.SymbolKind.Method : vscode.SymbolKind.Function) :
            rawKind === 'module' ? vscode.SymbolKind.Module :
              rawKind === 'trait' ? vscode.SymbolKind.Class :
                rawKind === 'type' ? vscode.SymbolKind.Struct : undefined;
      if (kind === undefined) {
        continue;
      }
      // TODO: the range should actually be the range of the module, class, function, etc... not of the symbol name
      const range = new vscode.Range(document.positionAt(nameIndices[0]), document.positionAt(nameIndices[1]));
      const location = new vscode.Location(document.uri, range);
      const containerName = currentClass ?? currentModule ?? '';
      results.push(new vscode.SymbolInformation(name, kind, containerName, location));
      if (rawKind === 'module') {
        currentModule = name;
        currentClass = undefined;
      } else if (rawKind === 'class' || rawKind === 'trait') {
        currentClass = name;
      }
    }
    return results;
  }
};

const addDefinitionsInDocument = (add: (loc: vscode.Location) => boolean, document: vscode.TextDocument, word: string, token: vscode.CancellationToken): boolean => {
  const symbolRE = new RegExp(`(?:\\b(?:class|const|fun|module|trait|type)\\s+\\.?${word}\\b|\\|\\s*\\.?${word}\\s*\\((?!.+->))`, 'dg');
  const text = document.getText();
  let match;
  while ((match = symbolRE.exec(text)) !== null) {
    if (token.isCancellationRequested)
      return false;
    const pos = document.positionAt(match.index);
    if (!add(new vscode.Location(document.uri, pos)))
      return false;
  }
  return true;
}

const documentDefinitionProvider = {
  async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Location[]> {
    const range = document.getWordRangeAtPosition(position);
    if (range === undefined) {
      return [];
    }
    const MAX_RESULTS = 100;
    const MAX_FILES_TO_SEARCH = 200;
    const inTests = /(^|[/])tests[/]/.test(document.fileName);
    const exclude = inTests ? '**/target/**' : '**/{target,tests}/**';
    const files = await vscode.workspace.findFiles('**/*.sk', exclude, MAX_FILES_TO_SEARCH, token);
    const word = document.getText(range);

    if (token.isCancellationRequested)
      return [];

    const results: vscode.Location[] = [];
    const add = (loc: vscode.Location): boolean => { results.push(loc); return (results.length <= MAX_RESULTS); };
    if (addDefinitionsInDocument(add, document, word, token)) {
      for (const file of files) {
        if (token.isCancellationRequested)
          break;
        if (file === document.uri) {
          continue;
        }
        const fileDocument = await vscode.workspace.openTextDocument(file);
        if (!addDefinitionsInDocument(add, fileDocument, word, token))
          break;
      }
    }
    return results;
  }
};

export function activate(context: vscode.ExtensionContext) {
  console.log("Skip extension is alive!");

  const skipBuffers = { language: "skip" };

  const formatterDisposable = vscode.languages.registerDocumentFormattingEditProvider(
    skipBuffers,
    documentFormattingEditProvider,
  );
  context.subscriptions.push(formatterDisposable);

  const symbolProviderDisposable = vscode.languages.registerDocumentSymbolProvider(
    skipBuffers,
    documentSymbolProvider,
  );
  context.subscriptions.push(symbolProviderDisposable);

  const definitionProviderDisposable = vscode.languages.registerDefinitionProvider(
    skipBuffers,
    documentDefinitionProvider,
  );
  context.subscriptions.push(definitionProviderDisposable);
}

export function deactivate() {
  console.log("Shutting down Skip extension");
}
