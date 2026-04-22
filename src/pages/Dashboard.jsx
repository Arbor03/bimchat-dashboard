import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const API = 'https://bimchat-api-production.up.railway.app'
const COLORS = ['#E74C3C', '#F39C12', '#27AE60']

const DownloadIcon = ({ size = 14 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

export default function Dashboard({ token, onLogout }) {
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [groupMessages, setGroupMessages] = useState([])
  const [privateMessages, setPrivateMessages] = useState([])
  const [attachmentsMap, setAttachmentsMap] = useState({})
  const [selectedUser, setSelectedUser] = useState(null)
  const [project, setProject] = useState('Project1')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [newMessage, setNewMessage] = useState('')
  const [newPrivateMessage, setNewPrivateMessage] = useState('')
  const [showScrollBtnGroup, setShowScrollBtnGroup] = useState(false)
  const [showScrollBtnPrivate, setShowScrollBtnPrivate] = useState(false)
  const [uploading, setUploading] = useState(false)
  const groupFileRef = useRef(null)
  const privateFileRef = useRef(null)
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
          loadAttachments(res.data)
        } else if (activeTab === 'private' && selectedUser) {
          const res = await axios.get(`${API}/messages/private/${project}/${selectedUser.email}`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          setPrivateMessages(res.data)
          loadAttachments(res.data)
        }
      } catch (err) { }
    }, 3000)
    return () => clearInterval(interval)
  }, [activeTab, project, selectedUser, token])

  const checkScroll = (ref, setShow) => {
    const el = ref.current?.parentElement
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
    setShow(!nearBottom)
  }

  useEffect(() => {
    const el = groupEndRef.current?.parentElement
    if (!el) return
    const handler = () => checkScroll(groupEndRef, setShowScrollBtnGroup)
    el.addEventListener('scroll', handler)
    return () => el.removeEventListener('scroll', handler)
  }, [activeTab])

  useEffect(() => {
    const el = privateEndRef.current?.parentElement
    if (!el) return
    const handler = () => checkScroll(privateEndRef, setShowScrollBtnPrivate)
    el.addEventListener('scroll', handler)
    return () => el.removeEventListener('scroll', handler)
  }, [activeTab, selectedUser])

  useEffect(() => {
    const el = groupEndRef.current?.parentElement
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      groupEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [groupMessages])

  useEffect(() => {
    const el = privateEndRef.current?.parentElement
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      privateEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [privateMessages])

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
      loadAttachments(groupRes.data)
      setTimeout(() => groupEndRef.current?.scrollIntoView({ behavior: 'auto' }), 100)
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
      loadAttachments(res.data)
      setTimeout(() => privateEndRef.current?.scrollIntoView({ behavior: 'auto' }), 100)
    } catch (err) {
      console.error(err)
    }
  }

  const loadAttachments = async (messages) => {
    const newMap = {}
    await Promise.all(messages.map(async m => {
      try {
        const res = await axios.get(`${API}/attachments/message/${m.id}`, { headers })
        if (res.data.length > 0) newMap[m.id] = res.data
      } catch { }
    }))
    setAttachmentsMap(prev => ({ ...prev, ...newMap }))
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
      loadAttachments(res.data)
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
      loadAttachments(res.data)
    } catch (err) { console.error(err) }
  }

  const uploadFile = async (file, messageId) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('message_id', messageId)
    await axios.post(`${API}/attachments/upload`, formData, {
      headers: { ...headers, 'Content-Type': 'multipart/form-data' }
    })
  }

  const handleFileSelect = async (e, isPrivate) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      alert('File too large (max 10MB)')
      return
    }
    setUploading(true)
    try {
      const messageId = crypto.randomUUID()
      const messageText = `📎 ${file.name}`

      await axios.post(`${API}/messages`, {
        id: messageId,
        project_name: project,
        message: messageText,
        receiver: isPrivate ? selectedUser.email : null
      }, { headers })

      await uploadFile(file, messageId)

      if (isPrivate) {
        const res = await axios.get(`${API}/messages/private/${project}/${selectedUser.email}`, { headers })
        setPrivateMessages(res.data)
        loadAttachments(res.data)
      } else {
        const res = await axios.get(`${API}/messages/group/${project}`, { headers })
        setGroupMessages(res.data)
        loadAttachments(res.data)
      }
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.error || err.message))
    }
    setUploading(false)
    e.target.value = ''
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
            className={`py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${activeTab === tab.id
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
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${task.status === 'Open' ? 'bg-red-100 text-red-600' :
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
              <div className="bg-white rounded-xl shadow flex flex-col relative" style={{ height: '70vh' }}>
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
                        {attachmentsMap[m.id]?.map(att => (
                          <div key={att.id} className="mt-2">
                            {att.resource_type === 'image' ? (
                              <div className="relative inline-block">
                                <a href={att.file_url} target="_blank" rel="noreferrer">
                                  <img src={att.file_url} alt={att.file_name} className="max-w-xs rounded-lg border" />
                                </a>
                                <a href={att.file_url.replace('/upload/', '/upload/fl_attachment/')}
                                  className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white w-8 h-8 rounded-full flex items-center justify-center"
                                  title="Download">
                                  <DownloadIcon size={16} />
                                </a>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 bg-white border rounded-lg p-2">
                                <a href={att.file_url} target="_blank" rel="noreferrer"
                                  className="flex items-center gap-2 flex-1 hover:bg-gray-50 rounded p-1">
                                  <span className="text-2xl">📄</span>
                                  <div>
                                    <div className="font-medium text-gray-700">{att.file_name}</div>
                                    <div className="text-xs text-gray-500">{(att.file_size / 1024).toFixed(1)} KB</div>
                                  </div>
                                </a>
                                <a href={att.file_url.replace('/upload/', '/upload/fl_attachment/')}
                                  className="bg-blue-700 hover:bg-blue-800 text-white p-2 rounded"
                                  title="Download">
                                  <DownloadIcon size={16} />
                                </a>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div ref={groupEndRef} />
                </div>
                {showScrollBtnGroup && (
                  <button
                    onClick={() => groupEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                    className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-blue-700 hover:bg-blue-800 text-white w-10 h-10 rounded-full shadow-lg flex items-center justify-center z-10"
                    title="Scroll to bottom">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                )}
                <div className="p-4 border-t flex gap-2 items-center">
                  <input
                    type="file"
                    ref={groupFileRef}
                    onChange={e => handleFileSelect(e, false)}
                    accept=".jpg,.jpeg,.png,.gif,.pdf,.dwg,.rvt"
                    style={{ display: 'none' }}
                  />
                  <button
                    onClick={() => groupFileRef.current?.click()}
                    disabled={uploading}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-700 w-10 h-10 rounded-lg text-xl font-bold transition disabled:opacity-50"
                    title="Attach file"
                  >
                    {uploading ? '⏳' : '+'}
                  </button>
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
                      className={`p-4 cursor-pointer border-b hover:bg-gray-50 transition ${selectedUser?.email === u.email ? 'bg-blue-50 border-l-4 border-blue-700' : ''
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
                <div className="flex-1 bg-white rounded-xl shadow flex flex-col relative">
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
                              <div className={`max-w-xs px-4 py-2 rounded-xl text-sm ${isMe ? 'bg-green-100 text-gray-800 rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'
                                }`}>
                                {m.message}
                                {m.element_name && (
                                  <div className="mt-1 text-blue-600 text-xs font-medium">🔗 {m.element_name}</div>
                                )}
                                {attachmentsMap[m.id]?.map(att => (
                                  <div key={att.id} className="mt-2">
                                    {att.resource_type === 'image' ? (
                                      <div className="relative">
                                        <a href={att.file_url} target="_blank" rel="noreferrer">
                                          <img src={att.file_url} alt={att.file_name} className="max-w-full rounded-lg border" />
                                        </a>
                                        <a href={att.file_url.replace('/upload/', '/upload/fl_attachment/')}
                                          className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white w-7 h-7 rounded-full flex items-center justify-center"
                                          title="Download">
                                          <DownloadIcon size={14} />
                                        </a>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2 bg-white border rounded p-2">
                                        <a href={att.file_url} target="_blank" rel="noreferrer"
                                          className="flex items-center gap-2 flex-1 overflow-hidden hover:bg-gray-50 rounded p-1">
                                          <span className="text-xl">📄</span>
                                          <div className="overflow-hidden">
                                            <div className="font-medium text-gray-700 truncate">{att.file_name}</div>
                                            <div className="text-xs text-gray-500">{(att.file_size / 1024).toFixed(1)} KB</div>
                                          </div>
                                        </a>
                                        <a href={att.file_url.replace('/upload/', '/upload/fl_attachment/')}
                                          className="bg-blue-700 hover:bg-blue-800 text-white p-2 rounded"
                                          title="Download">
                                          <DownloadIcon size={14} />
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                ))}
                                <div className="text-xs text-gray-400 mt-1 text-right">
                                  {new Date(m.created_at).toLocaleTimeString()}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                        <div ref={privateEndRef} />
                      </div>
                      {showScrollBtnPrivate && (
                        <button
                          onClick={() => privateEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                          className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-blue-700 hover:bg-blue-800 text-white w-10 h-10 rounded-full shadow-lg flex items-center justify-center z-10"
                          title="Scroll to bottom">
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                      )}
                      <div className="p-4 border-t flex gap-2 items-center">
                        <input
                          type="file"
                          ref={privateFileRef}
                          onChange={e => handleFileSelect(e, true)}
                          accept=".jpg,.jpeg,.png,.gif,.pdf,.dwg,.rvt"
                          style={{ display: 'none' }}
                        />
                        <button
                          onClick={() => privateFileRef.current?.click()}
                          disabled={uploading}
                          className="bg-gray-200 hover:bg-gray-300 text-gray-700 w-10 h-10 rounded-lg text-xl font-bold transition disabled:opacity-50"
                          title="Attach file"
                        >
                          {uploading ? '⏳' : '+'}
                        </button>
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
