import * as vscode from "vscode";
import * as which from "which";
import { execSync } from "child_process";

function formatSkipFile(fileName: string, fileContents: string): string {
  const skfmt = which.sync("skfmt");
  const command = `"${skfmt}" --assume-filename "${fileName}"`;
  console.log(command);
  return execSync(command, { encoding: "ascii", input: fileContents });
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
    const symbolRE = /(?:\b(?<kind>class|const|fun|module|trait|type)\s+|(?<child>[|])\s*)[.]?(?<name>\w+)/dg;

    const results = [];
    let currentModule = undefined;
    let currentClass = undefined;

    for (const match of document.getText().matchAll(symbolRE)) {
      const groups = match.groups;
      const indices = match.indices?.groups;
      if (groups === undefined || indices === undefined) {
        continue;
      }

      const rawKind = groups['kind'] ?? groups['child'];
      const name = groups['name'];
      const nameIndices = indices['name'];
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

const findDefinitionsInDocument = (document: vscode.TextDocument, word: string): vscode.Location[] => {
  const symbolRE = new RegExp(`(?:\\b(?:class|const|fun|module|trait|type)\\s+|[|]\\s*)[.]?${word}\\b`, 'dg');
  const text = document.getText();
  const results = [];
  let match;
  while ((match = symbolRE.exec(text)) !== null) {
    const pos = document.positionAt(match.index);
    results.push(new vscode.Location(document.uri, pos));
  }
  return results;
}

const documentDefinitionProvider = {
  async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Location[]> {
    const range = document.getWordRangeAtPosition(position);
    if (range === undefined) {
      return [];
    }
    const files = await vscode.workspace.findFiles('**/*.sk', '**/target/**', 100, token);
    const word = document.getText(range);

    const results = [findDefinitionsInDocument(document, word)];
    for (const file of files) {
      if (file === document.uri) {
        continue;
      }
      const fileDocument = await vscode.workspace.openTextDocument(file);
      results.push(findDefinitionsInDocument(fileDocument, word));
    }
    return results.flat();
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
