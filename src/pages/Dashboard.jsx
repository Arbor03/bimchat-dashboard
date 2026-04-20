import { useState, useEffect } from 'react'
import axios from 'axios'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const API = 'https://bimchat-api-production.up.railway.app'
const COLORS = ['#E74C3C', '#F39C12', '#27AE60']

export default function Dashboard({ token, onLogout }) {
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [project, setProject] = useState('Project1')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  const headers = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    loadData()
  }, [project])

  const loadData = async () => {
    setLoading(true)
    try {
      const [tasksRes, usersRes] = await Promise.all([
        axios.get(`${API}/tasks/${project}`, { headers }),
        axios.get(`${API}/users/${project}`, { headers })
      ])
      setTasks(tasksRes.data)
      setUsers(usersRes.data)
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  const stats = {
    open: tasks.filter(t => t.status === 'Open').length,
    inProgress: tasks.filter(t => t.status === 'InProgress').length,
    closed: tasks.filter(t => t.status === 'Closed').length,
  }

  const chartData = [
    { name: 'Open', value: stats.open },
    { name: 'In Progress', value: stats.inProgress },
    { name: 'Closed', value: stats.closed },
  ]

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center shadow">
        <div>
          <h1 className="text-2xl font-bold">BIM Chat Dashboard</h1>
          <p className="text-blue-200 text-sm">Project: {project}</p>
        </div>
        <div className="flex items-center gap-4">
          <input
            value={project}
            onChange={e => setProject(e.target.value)}
            className="bg-blue-600 text-white placeholder-blue-300 border border-blue-500 rounded-lg px-3 py-1 text-sm focus:outline-none"
            placeholder="Project name..."
          />
          <button
            onClick={onLogout}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-1 rounded-lg text-sm transition"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b px-6 flex gap-6">
        {['overview', 'tasks', 'users'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-3 text-sm font-medium border-b-2 transition capitalize ${
              activeTab === tab
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'overview' ? '📊 Overview' : tab === 'tasks' ? '📋 Tasks' : '👥 Users'}
          </button>
        ))}
      </div>

      <div className="p-6">
        {loading ? (
          <div className="text-center text-gray-500 py-20">Loading...</div>
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div>
                {/* Stats Cards */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-white rounded-xl shadow p-5 border-l-4 border-red-500">
                    <p className="text-gray-500 text-sm">Open</p>
                    <p className="text-3xl font-bold text-red-500">{stats.open}</p>
                  </div>
                  <div className="bg-white rounded-xl shadow p-5 border-l-4 border-yellow-500">
                    <p className="text-gray-500 text-sm">In Progress</p>
                    <p className="text-3xl font-bold text-yellow-500">{stats.inProgress}</p>
                  </div>
                  <div className="bg-white rounded-xl shadow p-5 border-l-4 border-green-500">
                    <p className="text-gray-500 text-sm">Closed</p>
                    <p className="text-3xl font-bold text-green-500">{stats.closed}</p>
                  </div>
                </div>

                {/* Chart */}
                <div className="bg-white rounded-xl shadow p-6">
                  <h2 className="text-lg font-semibold text-gray-700 mb-4">Task Status Distribution</h2>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {chartData.map((entry, index) => (
                          <Cell key={index} fill={COLORS[index]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Tasks Tab */}
            {activeTab === 'tasks' && (
              <div className="bg-white rounded-xl shadow overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 text-gray-600">Description</th>
                      <th className="text-left px-4 py-3 text-gray-600">Assignee</th>
                      <th className="text-left px-4 py-3 text-gray-600">Created By</th>
                      <th className="text-left px-4 py-3 text-gray-600">Status</th>
                      <th className="text-left px-4 py-3 text-gray-600">Created At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map(task => (
                      <tr key={task.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{task.description}</td>
                        <td className="px-4 py-3 text-gray-500">{task.assignee || '-'}</td>
                        <td className="px-4 py-3 text-gray-500">{task.created_by || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            task.status === 'Open' ? 'bg-red-100 text-red-600' :
                            task.status === 'InProgress' ? 'bg-yellow-100 text-yellow-600' :
                            'bg-green-100 text-green-600'
                          }`}>
                            {task.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {new Date(task.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tasks.length === 0 && (
                  <p className="text-center text-gray-500 py-10">No tasks found</p>
                )}
              </div>
            )}

            {/* Users Tab */}
            {activeTab === 'users' && (
              <div className="grid grid-cols-3 gap-4">
                {users.map(user => (
                  <div key={user.email} className="bg-white rounded-xl shadow p-5">
                    <div className="w-12 h-12 bg-blue-700 rounded-full flex items-center justify-center text-white font-bold text-lg mb-3">
                      {(user.full_name || user.email)[0].toUpperCase()}
                    </div>
                    <p className="font-semibold text-gray-700">{user.full_name || '-'}</p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                ))}
                {users.length === 0 && (
                  <p className="text-gray-500">No users found</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}