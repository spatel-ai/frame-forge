import { Navigate } from 'react-router'
import type { RouteObject } from 'react-router'
import AppShell from './components/AppShell'
import NotFound from './components/NotFound'
import CreatePage from './features/create/CreatePage'
import JobPage from './features/create/JobPage'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/create" replace /> },
      { path: 'create', element: <CreatePage /> },
      { path: 'create/:jobId', element: <JobPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

