<script lang="ts">
  // /events/create QueryClient provider. Same wrapper pattern as
  // forum's ComposePage.svelte so the mutation hooks can read the
  // client via useQueryClient() inside the inner component.

  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import EventComposePageInner from './EventComposePageInner.svelte';
  import type { Event as EventDoc, EventCopySource } from '../../../../types';

  let { mode = 'create', initialEvent, copyFrom } = $props<{
    mode?: 'create' | 'edit';
    initialEvent?: EventDoc;
    copyFrom?: EventCopySource;
  }>();

  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: false }
    }
  });
</script>

<QueryClientProvider {client}>
  <EventComposePageInner {mode} {initialEvent} {copyFrom} />
</QueryClientProvider>
