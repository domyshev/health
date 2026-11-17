import candy from '../../assets/sweets/candy.png'
import wafer from '../../assets/sweets/wafer.png'
import snickers from '../../assets/sweets/snickers.png'
import iceCream from '../../assets/sweets/ice-cream.png'
import gummy from '../../assets/sweets/gummy.png'
import condensedMilk from '../../assets/sweets/condensed-milk.png'

export const sweets = [
  { id: 'candy', label: 'Candy', image: candy },
  { id: 'wafer', label: 'Wafer', image: wafer },
  { id: 'snickers', label: 'Snickers', image: snickers },
  { id: 'ice-cream', label: 'Ice cream', image: iceCream },
  { id: 'gummy', label: 'Gummy candy', image: gummy },
  { id: 'condensed-milk', label: 'Condensed milk', image: condensedMilk },
] as const

export type SweetId = typeof sweets[number]['id']
