import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const API = 'https://bimchat-api-production.up.railway.app'
const COLORS = ['#E74C3C', '#F39C12', '#27AE60']

export default function Dashboard({ token, onLogout }) {
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [groupMessages, setGroupMessages] = useState([])
  const [privateMessages, setPrivateMessages] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [project, setProject] = useState('Project1')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [newMessage, setNewMessage] = useState('')
  const [newPrivateMessage, setNewPrivateMessage] = useState('')
  const groupEndRef = useRef(null)
  const privateEndRef = useRef(null)

  const headers = { Authorization: `Bearer ${token}` }

useEffect(() => { loadData() }, [project])

useEffect(() => {
  const interval = setInterval(async () => {
    try {
      if (activeTab === 'group') {
        const res = await axios.get(`${API}/messages/group/${project}`, { 
          headers: { Authorization: `Bearer ${token}` } 
        })
        setGroupMessages(res.data)
      } else if (activeTab === 'private' && selectedUser) {
        const res = await axios.get(`${API}/messages/private/${project}/${selectedUser.email}`, { 
          headers: { Authorization: `Bearer ${token}` } 
        })
        setPrivateMessages(res.data)
      }
    } catch(err) {}
  }, 3000)
  return () => clearInterval(interval)
}, [activeTab, project, selectedUser, token])

useEffect(() => { groupEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [groupMessages])
useEffect(() => { privateEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [privateMessages])

  const loadData = async () => {
    setLoading(true)
    try {
      const [tasksRes, usersRes, groupRes] = await Promise.all([
        axios.get(`${API}/tasks/${project}`, { headers }),
        axios.get(`${API}/users/${project}`, { headers }),
        axios.get(`${API}/messages/group/${project}`, { headers })
      ])
      setTasks(tasksRes.data)
      setUsers(usersRes.data)
      setGroupMessages(groupRes.data)
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  const loadPrivateMessages = async (user) => {
    setSelectedUser(user)
    try {
      const res = await axios.get(`${API}/messages/private/${project}/${user.email}`, { headers })
      setPrivateMessages(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  const sendGroupMessage = async () => {
    if (!newMessage.trim()) return
    try {
      await axios.post(`${API}/messages`, {
        id: crypto.randomUUID(),
        project_name: project,
        message: newMessage,
        receiver: null
      }, { headers })
      setNewMessage('')
      const res = await axios.get(`${API}/messages/group/${project}`, { headers })
      setGroupMessages(res.data)
    } catch (err) { console.error(err) }
  }

  const sendPrivateMessage = async () => {
    if (!newPrivateMessage.trim() || !selectedUser) return
    try {
      await axios.post(`${API}/messages`, {
        id: crypto.randomUUID(),
        project_name: project,
        message: newPrivateMessage,
        receiver: selectedUser.email
      }, { headers })
      setNewPrivateMessage('')
      const res = await axios.get(`${API}/messages/private/${project}/${selectedUser.email}`, { headers })
      setPrivateMessages(res.data)
    } catch (err) { console.error(err) }
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

  const tabs = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'tasks', label: '📋 Tasks' },
    { id: 'group', label: '💬 Group Chat' },
    { id: 'private', label: '🔒 Private Chat' },
    { id: 'users', label: '👥 Users' },
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
          <button onClick={onLogout} className="bg-blue-600 hover:bg-blue-500 px-4 py-1 rounded-lg text-sm transition">
            Logout
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b px-6 flex gap-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-6">
        {loading ? (
          <div className="text-center text-gray-500 py-20">Loading...</div>
        ) : (
          <>
            {/* Overview */}
            {activeTab === 'overview' && (
              <div>
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
                <div className="bg-white rounded-xl shadow p-6">
                  <h2 className="text-lg font-semibold text-gray-700 mb-4">Task Status Distribution</h2>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={chartData} cx="50%" cy="50%" outerRadius={100} dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}>
                        {chartData.map((_, index) => (
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

            {/* Tasks */}
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
                          }`}>{task.status}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{new Date(task.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tasks.length === 0 && <p className="text-center text-gray-500 py-10">No tasks found</p>}
              </div>
            )}

            {/* Group Chat */}
            {activeTab === 'group' && (
              <div className="bg-white rounded-xl shadow flex flex-col" style={{ height: '70vh' }}>
                <div className="p-4 border-b">
                  <h2 className="font-semibold text-gray-700">💬 Group Chat — {project}</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {groupMessages.map(m => (
                    <div key={m.id} className="flex flex-col">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-7 h-7 bg-blue-700 rounded-full flex items-center justify-center text-white text-xs font-bold">
                          {m.sender[0].toUpperCase()}
                        </div>
                        <span className="text-xs font-medium text-blue-700">{m.sender}</span>
                        <span className="text-xs text-gray-400">{new Date(m.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div className="ml-9 bg-gray-100 rounded-lg px-3 py-2 text-sm max-w-lg">
                        {m.message}
                        {m.element_name && (
                          <div className="mt-1 text-blue-600 text-xs font-medium">🔗 {m.element_name}</div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={groupEndRef} />
                </div>
                <div className="p-4 border-t flex gap-2">
                  <input
                    value={newMessage}
                    onChange={e => setNewMessage(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendGroupMessage()}
                    placeholder="Type a message..."
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={sendGroupMessage}
                    className="bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-800 transition"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}

            {/* Private Chat */}
            {activeTab === 'private' && (
              <div className="flex gap-4" style={{ height: '70vh' }}>
                {/* User List */}
                <div className="w-64 bg-white rounded-xl shadow overflow-y-auto">
                  <div className="p-4 border-b">
                    <h2 className="font-semibold text-gray-700">Messages</h2>
                  </div>
                  {users.map(u => (
                    <div
                      key={u.email}
                      onClick={() => loadPrivateMessages(u)}
                      className={`p-4 cursor-pointer border-b hover:bg-gray-50 transition ${
                        selectedUser?.email === u.email ? 'bg-blue-50 border-l-4 border-blue-700' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-blue-700 rounded-full flex items-center justify-center text-white font-bold text-sm">
                          {(u.full_name || u.email)[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-sm text-gray-700">{u.full_name || u.email}</p>
                          <p className="text-xs text-gray-400">{u.email}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Chat */}
                <div className="flex-1 bg-white rounded-xl shadow flex flex-col">
                  {selectedUser ? (
                    <>
                      <div className="p-4 border-b bg-blue-700 rounded-t-xl">
                        <h2 className="font-semibold text-white">{selectedUser.full_name || selectedUser.email}</h2>
                      </div>
                      <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {privateMessages.map(m => {
                          const isMe = m.sender !== selectedUser.email
                          return (
                            <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-xs px-4 py-2 rounded-xl text-sm ${
                                isMe ? 'bg-green-100 text-gray-800 rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'
                              }`}>
                                {m.message}
                                {m.element_name && (
                                  <div className="mt-1 text-blue-600 text-xs font-medium">🔗 {m.element_name}</div>
                                )}
                                <div className="text-xs text-gray-400 mt-1 text-right">
                                  {new Date(m.created_at).toLocaleTimeString()}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                        <div ref={privateEndRef} />
                      </div>
                      <div className="p-4 border-t flex gap-2">
                        <input
                          value={newPrivateMessage}
                          onChange={e => setNewPrivateMessage(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && sendPrivateMessage()}
                          placeholder="Type a message..."
                          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={sendPrivateMessage}
                          className="bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-800 transition"
                        >
                          Send
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                      Select a user to start chatting
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Users */}
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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}