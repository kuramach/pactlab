import { Pending } from '../../_components/pending';

/** While the website is being read (T-123): the shared wait state, with the brand's own words. */
export function BrandFetchWait() {
  return (
    <Pending
      label="Reading your website… the suggestions appear here in a few seconds."
      slow="This is taking longer than usual. The website may be slow or may block automated visits. Try “Fetch again” in a minute, or upload your logo and pick your colors below."
    />
  );
}
