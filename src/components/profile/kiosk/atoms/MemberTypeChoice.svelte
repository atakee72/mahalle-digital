<script lang="ts">
  // Three-way choice: Privatperson / Verein · Initiative / Gewerbe.
  // Used by the signup form and the profile edit state. A radio group, so
  // arrow keys and screen readers work without extra code.
  import { t } from '../../../../lib/kiosk-i18n';
  import { MEMBER_TYPES, type MemberType } from '../../../../lib/members/memberType';

  let { value, onchange, disabled = false, name = 'memberType' }: {
    value: MemberType;
    onchange: (v: MemberType) => void;
    disabled?: boolean;
    name?: string;
  } = $props();
</script>

<fieldset style="border: 0; margin: 0; padding: 0; min-width: 0;" {disabled}>
  <legend class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.14em; color: var(--k-ink-mute); margin-bottom: 6px; padding: 0;">
    {$t['member.type.label']}
  </legend>
  <div style="display: flex; flex-wrap: wrap; gap: 6px;">
    {#each MEMBER_TYPES as opt (opt)}
      <label
        class="font-bricolage focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--k-ink)]"
        data-member-choice={opt}
        style="
          position: relative; display: inline-flex; align-items: center; min-height: 36px; padding: 6px 12px;
          border: 1.5px solid var(--k-ink); border-radius: 999px; cursor: pointer;
          font-size: 13px; font-weight: 600;
          background: {value === opt ? 'var(--k-ink)' : 'var(--k-paper-soft)'};
          color: {value === opt ? 'var(--k-paper)' : 'var(--k-ink)'};
        "
      >
        <input
          type="radio"
          {name}
          value={opt}
          checked={value === opt}
          onchange={() => onchange(opt)}
          style="position: absolute; opacity: 0; width: 1px; height: 1px;"
        />
        {$t[`member.type.${opt}`]}
      </label>
    {/each}
  </div>
  <div class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute); margin-top: 6px;">
    {$t['member.type.hint']}
  </div>
</fieldset>
