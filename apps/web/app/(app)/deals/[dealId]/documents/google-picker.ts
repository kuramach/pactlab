'use client';

/**
 * Google's file picker (Kumar, 2026-11-24): people choose the Drive files a pact may read; under the
 * `drive.file` permission Pactlab can read those and nothing else. Every name below is from Google's
 * Picker reference (PickerBuilder, DocsView, Feature, Response, Action, Document); nothing is guessed.
 * The access token is the person's own, short-lived, fetched for this one opening and never stored.
 */

interface PickerDocument {
  readonly [key: string]: unknown;
}
interface PickerNamespace {
  PickerBuilder: new () => PickerBuilderInstance;
  DocsView: new (viewId: unknown) => { setIncludeFolders(included: boolean): { setSelectFolderEnabled(enabled: boolean): unknown } };
  ViewId: { DOCS: unknown };
  Feature: { MULTISELECT_ENABLED: unknown };
  Response: { ACTION: string; DOCUMENTS: string };
  Action: { PICKED: string; CANCEL: string };
  Document: { ID: string };
}
interface PickerBuilderInstance {
  addView(view: unknown): PickerBuilderInstance;
  enableFeature(feature: unknown): PickerBuilderInstance;
  setOAuthToken(token: string): PickerBuilderInstance;
  setDeveloperKey(key: string): PickerBuilderInstance;
  setAppId(appId: string): PickerBuilderInstance;
  setTitle(title: string): PickerBuilderInstance;
  setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilderInstance;
  build(): { setVisible(visible: boolean): void };
}
type PickerWindow = Window & { gapi?: { load(name: string, callback: () => void): void }; google?: { picker?: PickerNamespace } };

const SCRIPT = 'https://apis.google.com/js/api.js';

function loadScript(): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
  if (existing?.dataset['loaded'] === 'true') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => {
      script.dataset['loaded'] = 'true';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error('Google’s picker could not load.')));
    if (!existing) {
      script.src = SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/** Open Google's picker over the page; resolves with the chosen file ids (empty when cancelled). */
export async function chooseDriveFiles(input: { accessToken: string; apiKey: string; appId: string }): Promise<string[]> {
  await loadScript();
  const win = window as PickerWindow;
  await new Promise<void>((resolve) => win.gapi?.load('picker', resolve));
  const picker = win.google?.picker;
  if (!picker) throw new Error('Google’s picker could not load.');
  // Folders are shown so people can open them and choose the files inside; a folder itself is not chosen,
  // because choosing a folder does not, in Google's documentation, give access to what is in it.
  const view = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
  return new Promise((resolve) => {
    new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(input.accessToken)
      .setDeveloperKey(input.apiKey)
      .setAppId(input.appId)
      .setTitle('Choose the files this pact may read')
      .setCallback((data) => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.PICKED) {
          const documents = (data[picker.Response.DOCUMENTS] as PickerDocument[] | undefined) ?? [];
          resolve(documents.map((entry) => String(entry[picker.Document.ID])).filter(Boolean));
        } else if (action === picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .build()
      .setVisible(true);
  });
}
