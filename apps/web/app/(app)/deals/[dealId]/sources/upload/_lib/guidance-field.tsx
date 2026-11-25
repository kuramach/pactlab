'use client';

import { GUIDANCE_MAX_TEXT, GUIDANCE_STARTERS } from '@pactlab/domain';
import { Button } from '@pactlab/ui';
import { useState } from 'react';

/** Anything the AI should know about the file (T-152), with one-click starters. Sent with the upload as `instructions`. */
export function GuidanceField({ defaultValue = '' }: { defaultValue?: string }) {
  const [text, setText] = useState(defaultValue);
  const add = (starter: string) => setText((current) => (current.includes(starter) ? current : `${current.trim()}${current.trim() ? '. ' : ''}${starter}.`.slice(0, GUIDANCE_MAX_TEXT)));
  return (
    <div className="flex flex-col gap-2 text-sm">
      <label htmlFor="import-instructions" className="font-medium">
        Anything the AI should know about this file? <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <textarea
        id="import-instructions"
        name="instructions"
        rows={2}
        maxLength={GUIDANCE_MAX_TEXT}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="For example: row 1 is a title, amounts are annual"
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Starter instructions">
        {GUIDANCE_STARTERS.map((starter) => (
          <Button key={starter} type="button" size="sm" variant="outline" onClick={() => add(starter)}>
            {starter}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">It steers how the columns are read; it never changes a value in the file. Pactlab quotes it back on the next screen.</p>
    </div>
  );
}
