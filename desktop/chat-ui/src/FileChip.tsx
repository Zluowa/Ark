// @input: file name, onRemove callback
// @output: Dismissible file attachment chip
// @position: Leaf UI component — pure display

interface Props {
  name: string
  onRemove: () => void
}

const EXT_ICONS: Record<string, string> = {
  pdf: 'PDF',
  jpg: 'IMG', jpeg: 'IMG', png: 'IMG', gif: 'IMG', webp: 'IMG', svg: 'IMG',
}

export function FileChip({ name, onRemove }: Props) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const icon = EXT_ICONS[ext] ?? 'FILE'

  return (
    <div className="file-chip" title={icon}>
      <span className="file-icon" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>{icon}</span>
      <span className="remove-btn" onClick={onRemove} role="button" aria-label="Remove file">x</span>
    </div>
  )
}
