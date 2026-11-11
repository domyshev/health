import type { Activity, ActivityFieldSetting } from '../../api/healthApi'

export type Field = ActivityFieldSetting['fields'][number]
export type ActivityView = ActivityFieldSetting['view']

export const fieldLabels: Record<Field, string> = {
  distanceM: 'Distance', durationS: 'Duration', movingDurationS: 'Moving time',
  elapsedDurationS: 'Elapsed time', caloriesKcal: 'Calories', averageHrBpm: 'Average heart rate',
  maxHrBpm: 'Maximum heart rate', poolLengthM: 'Pool length', averagePacePer100mS: 'Average pace',
  swimEnvironment: 'Swim environment',
  activeLengths: 'Active lengths', lapCount: 'Laps', totalStrokes: 'Total strokes',
  averageStrokesPerLength: 'Strokes per length', averageSwolf: 'Average SWOLF',
}

const swimFields: Field[] = ['swimEnvironment', 'poolLengthM', 'averagePacePer100mS', 'activeLengths', 'lapCount', 'totalStrokes', 'averageStrokesPerLength', 'averageSwolf']
export function availableFields(type: Activity['type']): Field[] {
  return (Object.keys(fieldLabels) as Field[]).filter((field) => type === 'swimming' || !swimFields.includes(field))
}

export function defaultFields(type: Activity['type'], view: ActivityView): Field[] {
  const fields: Field[] = view === 'list' ? ['distanceM', 'durationS', 'averageHrBpm', 'caloriesKcal'] : availableFields(type)
  if (view === 'list' && type === 'swimming') fields.push('swimEnvironment', 'averagePacePer100mS')
  return ['cardio', 'elliptical', 'strength'].includes(type) ? fields.filter((field) => field !== 'distanceM') : fields
}

function duration(seconds: number) {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${total % 60}s`].filter(Boolean).join(' ')
}

export function fieldValue(activity: Activity, field: Field): string | undefined {
  if (field === 'swimEnvironment') return activity.swimEnvironment?.replace('_', ' ')
  const value = activity[field]
  if (value === undefined || value === null) return undefined
  switch (field) {
    case 'distanceM': return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value)} m`
    case 'durationS': case 'movingDurationS': case 'elapsedDurationS': return duration(value)
    case 'caloriesKcal': return `${Math.round(value)} kcal`
    case 'averageHrBpm': case 'maxHrBpm': return `${Math.round(value)} bpm`
    case 'poolLengthM': return `${value} m`
    case 'averagePacePer100mS': return `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, '0')} /100m`
    case 'averageStrokesPerLength': return value.toFixed(1)
    default: return String(value)
  }
}
