import * as vscode from "vscode";
import * as which from "which";
import { execSync } from "child_process";

function formatSkipText(text: string): string {
  const skfmt = which.sync("skfmt");
  return execSync(`"${skfmt}"`, { encoding: "ascii", input: text });
}

const documentFormattingEditProvider = {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
  ): vscode.TextEdit[] {
    const fullText = document.getText();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(fullText.length - 1),
    );
    try {
      const newText = formatSkipText(fullText);

      return [vscode.TextEdit.replace(fullRange, newText)];
    } catch (error) {
      const info =
        error instanceof Error && "stderr" in error ? error.stderr : error;
      vscode.window.showErrorMessage(`Skip: cannot format.\n${info}`);
      return [];
    }
  },
};

export function activate(context: vscode.ExtensionContext) {
  console.log("Skip extension is alive!");

  const disposable = vscode.languages.registerDocumentFormattingEditProvider(
    { scheme: "file", language: "skip" },
    documentFormattingEditProvider,
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {
  console.log("Shutting down Skip extension");
}
