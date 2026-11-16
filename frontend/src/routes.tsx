import { createBrowserRouter, Navigate } from 'react-router'
import AppShell from './components/AppShell'
import NotFound from './components/NotFound'
import CreatePage from './features/create/CreatePage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/create" replace /> },
      { path: 'create', element: <CreatePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
