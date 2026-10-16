// Bouton « Beautify » des éditeurs de body et de scripts ; l'infobulle rappelle le raccourci.

import { t } from '@shared/i18n'
import { comboLabel, effectiveShortcuts } from '@shared/shortcuts'
import { isMac, useSettings } from '../stores/settings'

export function BeautifyButton({ onClick }: { onClick: () => void }) {
  const overrides = useSettings((s) => s.settings.shortcuts)
  const combo = effectiveShortcuts(overrides).beautify[0]
  return (
    <button type="button" className="link beautify-btn" onClick={onClick} title={combo ? t('req.beautifyTitle', { shortcut: comboLabel(combo, isMac) }) : undefined}>
      {t('req.beautify')}
    </button>
  )
}
