import type { ClientModule } from 'claude-code'

// What the board hands each card: everything drawn, already worked out.
export type CardProps = {
  id: string
  width: number
  color: string
  text: string
  muted: string
  critter: string[]
  name: string
  label: string
  lines: string[]
  isWorking: boolean
}

type CardState = { isHovered: boolean }

// One agent's card. A click anywhere on it, or Enter while it has the focus, opens its chat.
const Card: ClientModule<CardProps, CardState> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ isHovered: false })
    surface.onPointer(event => {
      if (event.type === 'enter') {
        surface.setState({ isHovered: true })
      } else if (event.type === 'leave') {
        surface.setState({ isHovered: false })
      } else if (event.type === 'up' && event.button === 'left') {
        surface.post({ open: props.id })
      }
    })
    surface.onKey(event => {
      if (event.key === 'return') {
        surface.post({ open: props.id })
      }
    })
  }

  const { Box, Text } = surface.elements
  const isHovered = surface.state?.isHovered === true
  const [head = '', body = '', legs = ''] = props.critter

  return (
    <Box
      width={props.width}
      height={7}
      flexDirection="column"
      borderStyle={isHovered ? 'bold' : 'round'}
      borderColor={props.color}
      paddingX={1}
    >
      <Box>
        <Text color={props.color}>{head}</Text>
        <Text color={props.text} bold underline={isHovered}>
          {` ${props.name}`}
        </Text>
      </Box>
      <Box>
        <Text color={props.color}>{body}</Text>
        <Text color={props.color} bold={isHovered}>
          {isHovered ? ' chat ›' : ` ${props.label}`}
        </Text>
      </Box>
      <Text color={props.color}>{legs}</Text>
      {props.lines.map((line, i) => (
        <Text key={`line-${i}`} color={props.isWorking ? props.text : props.muted}>
          {line}
        </Text>
      ))}
    </Box>
  )
}

export default Card
