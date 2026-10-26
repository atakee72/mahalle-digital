<script lang="ts">
  import { t } from '../../lib/kiosk-i18n';
  const GITHUB_URL = 'https://github.com/atakee72/mahalle-digital';
</script>

<div class="demo-banner font-dmmono" role="note">
  <span>{$t['demo.banner']}</span>
  <a href={GITHUB_URL} target="_blank" rel="noopener">{$t['demo.banner.code']}</a>
</div>

<style>
  .demo-banner {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px 16px;
    background: var(--k-ochre); color: var(--k-ink);
    padding: 7px 16px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
    border-bottom: 1.5px solid var(--k-ink);
  }
  .demo-banner a { color: var(--k-ink); font-weight: 600; border-bottom: 1px solid var(--k-ink); text-decoration: none; }
</style>
