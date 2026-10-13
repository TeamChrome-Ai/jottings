import Alias from '../../src/components/Alias'

/** /jottings/<id> opens the jotting at /outlines/<id>. */
export default function JottingAlias() {
  return <Alias to="/outlines/[id]" />
}
