<script lang="ts">
  // State §01 — loading. Mirrors only the content BELOW the instrument strip
  // (the strip itself carries its own skeleton once KzInstrumentStrip lands
  // in Task 4). No spinner, no emoji — see kiosk-kiezdaten-states.jsx:62-72
  // (desktop) and :188-190 (mobile).
</script>

<div class="px-4 md:px-9 py-8 lg:px-10" aria-hidden="true">
  <!-- mobile: two stacked bars (states.jsx:188-190) -->
  <div class="flex flex-col gap-2.5 lg:hidden">
    <div class="kz-skel h-14 rounded-lg"></div>
    <div class="kz-skel h-14 rounded-lg"></div>
  </div>

  <!-- desktop: title-row (fixed 180px + flex) then a Kanal-block bar (states.jsx:68-71) -->
  <div class="hidden lg:block">
    <div class="flex gap-2.5">
      <div class="kz-skel h-[70px] w-[180px] rounded-lg"></div>
      <div class="kz-skel h-[70px] flex-1 rounded-lg"></div>
    </div>
    <div class="kz-skel mt-2.5 h-[90px] rounded-lg"></div>
  </div>
</div>
