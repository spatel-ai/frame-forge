import { createContext, useContext } from 'react'

/** Lets a SelectableCardGroup supply the shared radio `name` to its cards. */
export const SelectableCardGroupContext = createContext<{ name?: string }>({})

export function useSelectableCardGroup() {
  return useContext(SelectableCardGroupContext)
}
