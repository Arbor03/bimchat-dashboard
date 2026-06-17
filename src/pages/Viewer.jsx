import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import * as OBC from '@thatopen/components'
import * as FRAGS from '@thatopen/fragments'
import * as THREE from 'three'

const API = 'https://bimchat-api-production.up.railway.app'

// Visual + ordering config for conversation levels (project > folder > model)
const LEVEL_META = {
  project: { order: 0, icon: '🌐', header: 'Project',               border: 'border-l-indigo-500', badge: 'bg-indigo-100 text-indigo-700' },
  folder:  { order: 1, icon: '📁', header: 'Folders / Disciplines', border: 'border-l-amber-500',  badge: 'bg-amber-100 text-amber-700' },
  model:   { order: 2, icon: '🧊', header: 'Models',                border: 'border-l-teal-500',   badge: 'bg-teal-100 text-teal-700' },
}

// 3D viewer + side panel organized like the Revit add-in: Tasks | Chat.
//
// SINGLE mode: one model (fileId). FEDERATED mode: several models loaded into the
// same scene (files=[{id,name}], federated=true). In federated mode you "enter" a
// model by clicking any of its elements (or it stays project/folder-level until
// then); double-clicking empty space exits back to project/folder context.
//
// Pull the current user's email out of the JWT (payload has { id, email }).
function emailFromToken(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(decodeURIComponent(escape(atob(part))))
    return payload.email || null
  } catch { return null }
}

export default function Viewer({
  fileId, fileName, projectName, projectId,
  folders = [], projectFiles = [], projectMembers = [],
  files = null, federated = false,
  token, userEmail: userEmailProp, onClose
}) {
  const userEmail = userEmailProp || emailFromToken(token)

  // ----- model set (works for both single and federated) -----
  const federatedMode = federated && Array.isArray(files) && files.length > 0
  const modelList = federatedMode ? files : [{ id: fileId, name: fileName }]
  const modelKey = modelList.map(m => m.id).join(',')

  const containerRef = useRef(null)
  const componentsRef = useRef(null)
  const fragsRef = useRef(null)
  const worldRef = useRef(null)
  const modelRef = useRef(null)            // a fallback model (first loaded)
  const modelIdToFileIdRef = useRef({})    // 'file-12' -> 12
  const chatEndRef = useRef(null)

  const fileIdOfModelId = (mId) => modelIdToFileIdRef.current[mId]
  const nameOfFile = (fid) =>
    (modelList.find(m => m.id === fid)?.name) ||
    (projectFiles || []).find(f => f.id === fid)?.file_name || 'Model'

  const [status, setStatus] = useState(federatedMode ? 'ready' : 'loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [selected, setSelected] = useState(null) // { name, ifcGuid, elementId, elementName, localId, modelId, fileId }
  const selectedRef = useRef(null)
  useEffect(() => { selectedRef.current = selected }, [selected])

  // which model is "entered" (active chat + element-link context)
  const [activeFileId, setActiveFileId] = useState(federatedMode ? null : fileId)
  const activeFileIdRef = useRef(activeFileId)
  useEffect(() => { activeFileIdRef.current = activeFileId }, [activeFileId])

  const [activeTab, setActiveTab] = useState('chat') // chat | tasks
  const [sectionActive, setSectionActive] = useState(false)
  const [sectionPad, setSectionPad] = useState(0.6)
  const sectionBaseBoxRef = useRef(null)
  const [contextMenu, setContextMenu] = useState(null)
  const casterRef = useRef(null)
  const [clipMode, setClipMode] = useState(false)
  const clipperRef = useRef(null)
  const clipModeRef = useRef(false)
  const [planesVisible, setPlanesVisible] = useState(true)
  const [showProps, setShowProps] = useState(false)
  const [props, setProps] = useState(null)
  const [loadingProps, setLoadingProps] = useState(false)
  useEffect(() => { clipModeRef.current = clipMode }, [clipMode])

  const [users, setUsers] = useState([])

  // ---------- chat (conversations) ----------
  const [conversations, setConversations] = useState([])
  const [selectedConv, setSelectedConv] = useState(null)
  const [convMessages, setConvMessages] = useState([])
  const [newConvMessage, setNewConvMessage] = useState('')
  const [showNewConvModal, setShowNewConvModal] = useState(false)
  const [ncType, setNcType] = useState('dm')
  const [ncName, setNcName] = useState('')
  const [ncMembers, setNcMembers] = useState([])
  const [ncLevel, setNcLevel] = useState(federatedMode ? 'project' : 'model')
  const [ncFolderId, setNcFolderId] = useState('')
  const [ncFileId, setNcFileId] = useState(federatedMode ? '' : String(fileId))

  // tasks
  const [tasks, setTasks] = useState([])
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')

  const headers = { Authorization: `Bearer ${token}` }
  const pn = encodeURIComponent(projectName || '')

  // effective file id for tasks / new messages (selected element's model, else active)
  const effectiveFileId = () =>
    selectedRef.current?.fileId ?? activeFileIdRef.current ?? (federatedMode ? null : fileId)

  // ---------- conversion status (single mode only) ----------
  useEffect(() => {
    if (federatedMode) { setStatus('ready'); return }
    let cancelled = false
    let timer = null
    const check = async () => {
      try {
        const res = await axios.get(`${API}/web-export/${fileId}/status`, { headers })
        if (cancelled) return
        const s = res.data.status
        if (s === 'ready' && res.data.hasFrag) setStatus('ready')
        else if (s === 'pending') { setStatus('pending'); timer = setTimeout(check, 3000) }
        else if (s === 'error') { setStatus('error'); setErrorMsg(res.data.error || 'Conversion failed') }
        else setStatus('none')
      } catch (err) {
        if (!cancelled) { setStatus('error'); setErrorMsg(err.response?.data?.error || err.message) }
      }
    }
    check()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [fileId, federatedMode])

  // ---------- data loaders ----------
  const loadUsers = async () => {
    if (!projectName) return
    try {
      const res = await axios.get(`${API}/users/${pn}`, { headers })
      setUsers(res.data)
    } catch {}
  }
  const loadTasks = async () => {
    if (!projectName) return
    try {
      const tfid = activeFileId ?? (federatedMode ? null : fileId)
      const url = tfid ? `${API}/tasks/${pn}?fileId=${tfid}` : `${API}/tasks/${pn}`
      const res = await axios.get(url, { headers })
      setTasks(res.data)
    } catch {}
  }
  const loadConversations = async () => {
    if (!projectId) return
    try {
      const res = await axios.get(`${API}/conversations?project_id=${projectId}`, { headers })
      setConversations(res.data)
    } catch {}
  }
  const loadConvMessages = async (id) => {
    try {
      const res = await axios.get(`${API}/conversations/${id}/messages`, { headers })
      setConvMessages(res.data)
    } catch {}
  }

  // poll the active tab
  useEffect(() => {
    if (status !== 'ready') return
    let iv = null
    if (activeTab === 'tasks') {
      loadUsers(); loadTasks(); iv = setInterval(loadTasks, 3000)
    } else if (activeTab === 'chat') {
      loadUsers(); loadConversations()
      if (selectedConv) {
        loadConvMessages(selectedConv.id)
        iv = setInterval(() => loadConvMessages(selectedConv.id), 3000)
      } else {
        iv = setInterval(loadConversations, 8000)
      }
    }
    return () => { if (iv) clearInterval(iv) }
  }, [status, activeTab, selectedConv, projectId, modelKey, activeFileId])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [convMessages])

  // ---------- viewer init (loads ALL models in modelList) ----------
  useEffect(() => {
    if (status !== 'ready' || !containerRef.current) return
    let disposed = false

    const init = async () => {
      try {
        const components = new OBC.Components()
        componentsRef.current = components

        const worlds = components.get(OBC.Worlds)
        const world = worlds.create()
        world.scene = new OBC.SimpleScene(components)
        world.renderer = new OBC.SimpleRenderer(components, containerRef.current)
        world.camera = new OBC.OrthoPerspectiveCamera(components)

        // Mouse buttons like Revit: middle (press wheel) = pan, wheel scroll = zoom.
        try {
          const ctrls = world.camera.controls
          ctrls.mouseButtons.left = 1     // rotate (orbit)
          ctrls.mouseButtons.middle = 2   // truck = pan (hold wheel)
          ctrls.mouseButtons.right = 0    // free (context menu)
          ctrls.mouseButtons.wheel = 16   // zoom on scroll
        } catch {}

        components.init()
        world.scene.setup()
        world.scene.three.background = null

        const grids = components.get(OBC.Grids)
        grids.create(world)

        setTimeout(() => {
          try {
            containerRef.current?.querySelectorAll('[data-thatopen-logo]')
              .forEach(el => el.remove())
          } catch {}
        }, 0)

        const workerUrl = await OBC.FragmentsManager.getWorker()
        const fragments = components.get(OBC.FragmentsManager)
        fragments.init(workerUrl)
        fragsRef.current = fragments
        worldRef.current = world

        world.camera.controls.addEventListener('update', () => fragments.core.update())
        world.onCameraChanged.add((camera) => {
          for (const [, model] of fragments.list) model.useCamera(camera.three)
          fragments.core.update(true)
        })
        fragments.list.onItemSet.add(({ value: model }) => {
          model.useCamera(world.camera.three)
          world.scene.three.add(model.object)
          fragments.core.update(true)
        })
        fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
          if (!('isLodMaterial' in material && material.isLodMaterial)) {
            material.polygonOffset = true
            material.polygonOffsetUnits = 1
            material.polygonOffsetFactor = Math.random()
          }
        })

        // --- load every model in the set ---
        modelIdToFileIdRef.current = {}
        const loadedObjects = []
        for (const m of modelList) {
          try {
            const urlRes = await axios.get(`${API}/web-export/${m.id}/frag-url`, { headers })
            const fragUrl = urlRes.data.downloadUrl
            if (!fragUrl) { console.warn('no frag url for', m.id); continue }
            const modelId = `file-${m.id}`
            const resp = await fetch(fragUrl)
            if (!resp.ok) { console.warn('frag download failed', m.id, resp.status); continue }
            const buffer = await resp.arrayBuffer()
            if (disposed) return
            await fragments.core.load(buffer, { modelId })
            modelIdToFileIdRef.current[modelId] = m.id
            const model = fragments.list.get(modelId)
            if (!modelRef.current) modelRef.current = model
            if (model && model.object) loadedObjects.push(model.object)
          } catch (e) { console.warn('load model failed', m.id, e) }
        }
        await fragments.core.update(true)

        if (!loadedObjects.length) throw new Error('No models could be loaded.')

        // fit the combined bounding box (isometric look)
        try {
          const box = new THREE.Box3()
          for (const o of loadedObjects) box.expandByObject(o)
          const center = new THREE.Vector3()
          const size = new THREE.Vector3()
          box.getCenter(center)
          box.getSize(size)
          const radius = Math.max(size.x, size.y, size.z) || 10
          const d = radius * 1.6
          await world.camera.controls.setLookAt(
            center.x + d, center.y + d, center.z + d,
            center.x, center.y, center.z,
            false
          )
          const sphere = new THREE.Sphere()
          box.getBoundingSphere(sphere)
          if (sphere.radius > 0) await world.camera.controls.fitToSphere(sphere, true)
        } catch (e) { console.warn('fit failed', e) }

        const casters = components.get(OBC.Raycasters)
        const caster = casters.get(world)
        casterRef.current = caster
        const highlightColor = new THREE.Color('#3b82f6')

        const onClick = async () => {
          if (clipModeRef.current) {
            try {
              const plane = clipperRef.current?.create(world)
              try {
                const ctrls = plane?.controls || plane?._controls
                if (ctrls) {
                  if (typeof ctrls.setSize === 'function') ctrls.setSize(0.4)
                  else ctrls.size = 0.4
                }
              } catch {}
              await fragsRef.current?.core.update(true)
            } catch (e) { console.warn('clip create failed:', e) }
            setClipMode(false)
            return
          }
          try {
            const result = await caster.castRay()
            if (!result) {
              await fragments.resetHighlight()
              await fragments.core.update(true)
              setSelected(null)
              return
            }
            const mId = result.fragments.modelId
            const localId = result.localId
            const model = fragments.list.get(mId)
            if (!model) return
            const clickedFileId = fileIdOfModelId(mId)

            let ifcGuid = null
            try {
              const guids = await model.getGuidsByLocalIds([localId])
              ifcGuid = guids && guids[0] ? guids[0] : null
            } catch {}

            let name = ''
            try {
              const [data] = await model.getItemsData([localId])
              if (data && data.Name && 'value' in data.Name) name = data.Name.value
            } catch {}

            let elementId = -1
            let elementName = name
            if (ifcGuid && clickedFileId) {
              try {
                const r = await axios.get(`${API}/element-mapping/${clickedFileId}/resolve`,
                  { params: { guid: ifcGuid }, headers })
                if (r.data.found) { elementId = r.data.elementId; elementName = r.data.elementName || name }
              } catch {}
            }

            const modelIdMap = { [mId]: new Set([localId]) }
            await fragments.resetHighlight()
            await fragments.highlight(
              { color: highlightColor, renderedFaces: FRAGS.RenderedFaces.TWO, opacity: 1, transparent: false },
              modelIdMap
            )
            await fragments.core.update(true)

            setSelected({
              name: name || elementName || '(no name)',
              ifcGuid, elementId, elementName, localId, modelId: mId, fileId: clickedFileId
            })

            // clicking an element "enters" its model (federated chat context)
            if (federatedMode && clickedFileId != null) setActiveFileId(clickedFileId)
          } catch (e) { console.error('select error:', e) }
        }

        containerRef.current.addEventListener('click', onClick)

        // double-click on empty space exits the active model (federated only)
        const onDblClick = async () => {
          if (!federatedMode || clipModeRef.current) return
          try {
            const result = await caster.castRay()
            if (!result) {
              setActiveFileId(null)
              setSelected(null)
              await fragments.resetHighlight()
              await fragments.core.update(true)
            }
          } catch {}
        }
        containerRef.current.addEventListener('dblclick', onDblClick)

        const onContextMenu = async (ev) => {
          ev.preventDefault()
          if (!clipModeRef.current) await onClick()
          setContextMenu({ x: ev.clientX, y: ev.clientY })
        }
        containerRef.current.addEventListener('contextmenu', onContextMenu)

        const clipper = components.get(OBC.Clipper)
        clipper.enabled = true
        try {
          clipper.config.visible = true
          clipper.config.opacity = 0.25
          clipper.config.size = 5
          clipper.config.color = new THREE.Color('#3b82f6')
        } catch {}
        clipperRef.current = clipper

        componentsRef.current._onClick = onClick
        componentsRef.current._onDblClick = onDblClick
        componentsRef.current._onContextMenu = onContextMenu
        componentsRef.current._container = containerRef.current
      } catch (err) {
        console.error('Viewer error:', err)
        if (!disposed) { setStatus('error'); setErrorMsg(err.message || 'Failed to open model.') }
      }
    }

    init()
    return () => {
      disposed = true
      try {
        const c = componentsRef.current
        if (c && c._container) {
          if (c._onClick) c._container.removeEventListener('click', c._onClick)
          if (c._onDblClick) c._container.removeEventListener('dblclick', c._onDblClick)
          if (c._onContextMenu) c._container.removeEventListener('contextmenu', c._onContextMenu)
        }
        c?.dispose?.()
      } catch {}
      componentsRef.current = null
      modelRef.current = null
    }
  }, [status, modelKey])

  // ---------- focus an element from a stored link (element_id + file_id -> ifc_guid -> localId) ----------
  const focusElement = async (elementId, linkFileId) => {
    if (!elementId || elementId === -1) return
    const fragments = fragsRef.current
    if (!fragments) return
    const fid = linkFileId ?? activeFileIdRef.current ?? (federatedMode ? null : fileId)
    if (!fid) return
    const modelId = `file-${fid}`
    const model = fragments.list.get(modelId)
    if (!model) return

    let ifcGuid = null
    let resolvedName = ''
    try {
      const r = await axios.get(`${API}/element-mapping/${fid}/by-element`,
        { params: { elementId }, headers })
      if (r.data.found) { ifcGuid = r.data.ifcGuid; resolvedName = r.data.elementName || '' }
    } catch {}
    if (!ifcGuid) return

    let localIds = []
    try { localIds = await model.getLocalIdsByGuids([ifcGuid]) } catch {}
    const localId = localIds && localIds.length ? localIds[0] : null
    if (localId === null || localId === undefined) return

    const modelIdMap = { [modelId]: new Set([localId]) }
    try {
      await fragments.resetHighlight()
      await fragments.highlight(
        { color: new THREE.Color('#3b82f6'), renderedFaces: FRAGS.RenderedFaces.TWO, opacity: 1, transparent: false },
        modelIdMap
      )
      await fragments.core.update(true)
    } catch {}

    setSelected({ name: resolvedName || '(no name)', ifcGuid, elementId, elementName: resolvedName, localId, modelId, fileId: fid })
    if (federatedMode) setActiveFileId(fid)

    await sectionBoxForLocalId(localId, modelId)
  }

  // ---------- section box around a given localId (crop the model) ----------
  const applyClippingFromBox = async (baseBox, pad, doFit) => {
    const world = worldRef.current
    if (!baseBox || !world) return
    const box = baseBox.clone().expandByScalar(pad)
    const renderer = world.renderer.three
    renderer.localClippingEnabled = true
    const min = box.min, max = box.max
    renderer.clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -min.x),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), max.x),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -min.y),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), max.y),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -min.z),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), max.z),
    ]
    await fragsRef.current?.core.update(true)
    if (doFit) {
      try {
        const sphere = new THREE.Sphere()
        box.getBoundingSphere(sphere)
        if (sphere.radius > 0) await world.camera.controls.fitToSphere(sphere, true)
      } catch {}
    }
  }

  const sectionBoxForLocalId = async (localId, modelId) => {
    if (localId == null) return
    const mId = modelId || selectedRef.current?.modelId
    if (!mId) return
    try {
      const modelIdMap = { [mId]: new Set([localId]) }
      const boxer = componentsRef.current.get(OBC.BoundingBoxer)
      boxer.list.clear()
      await boxer.addFromModelIdMap(modelIdMap)
      const box = boxer.get()
      boxer.list.clear()
      if (!box) return

      sectionBaseBoxRef.current = box.clone()
      await applyClippingFromBox(box, sectionPad, true)
      setSectionActive(true)
    } catch (e) { console.warn('section box failed:', e) }
  }

  const onSectionPadChange = async (val) => {
    setSectionPad(val)
    if (sectionActive && sectionBaseBoxRef.current) {
      await applyClippingFromBox(sectionBaseBoxRef.current, val, false)
    }
  }

  const applySectionBox = async () => {
    const sel = selectedRef.current
    if (!sel || sel.localId == null) return
    await sectionBoxForLocalId(sel.localId, sel.modelId)
  }

  const clearSectionBox = async () => {
    const world = worldRef.current
    if (!world) return
    try {
      world.renderer.three.clippingPlanes = []
      await fragsRef.current?.core.update(true)
    } catch {}
    sectionBaseBoxRef.current = null
    setSectionActive(false)
  }

  // ---------- hide / isolate (Hider) ----------
  const hideSelected = async () => {
    const sel = selectedRef.current
    if (!sel || sel.localId == null) return
    try {
      const hider = componentsRef.current.get(OBC.Hider)
      await hider.set(false, { [sel.modelId]: new Set([sel.localId]) })
      await fragsRef.current?.core.update(true)
    } catch (e) { console.warn('hide failed:', e) }
    setContextMenu(null)
  }

  const isolateSelected = async () => {
    const sel = selectedRef.current
    if (!sel || sel.localId == null) return
    try {
      const hider = componentsRef.current.get(OBC.Hider)
      await hider.isolate({ [sel.modelId]: new Set([sel.localId]) })
      await fragsRef.current?.core.update(true)
    } catch (e) { console.warn('isolate failed:', e) }
    setContextMenu(null)
  }

  const showAll = async () => {
    try {
      const hider = componentsRef.current.get(OBC.Hider)
      await hider.set(true)
      await fragsRef.current?.core.update(true)
    } catch (e) { console.warn('show all failed:', e) }
    setContextMenu(null)
  }

  // ---------- manual clipping planes (Clipper) ----------
  const toggleClipMode = () => setClipMode(prev => !prev)

  const deleteAllClips = () => {
    try { clipperRef.current?.deleteAll() } catch {}
  }

  const deleteClipHere = async () => {
    try {
      clipperRef.current?.delete(worldRef.current)
      await fragsRef.current?.core.update(true)
    } catch (e) { console.warn('clip delete failed:', e) }
    setContextMenu(null)
  }

  const togglePlanesVisible = () => {
    const clipper = clipperRef.current
    if (!clipper) return
    const next = !planesVisible
    try {
      clipper.config.visible = next
      for (const [, plane] of clipper.list) {
        try {
          if ('visible' in plane) plane.visible = next
          const ctrls = plane.controls || plane._controls
          if (ctrls) ctrls.visible = next
          if (plane.helper) plane.helper.visible = next
        } catch {}
      }
      worldRef.current?.renderer?.three && fragsRef.current?.core.update(true)
    } catch {}
    setPlanesVisible(next)
  }

  // ---------- exit the active model (federated) ----------
  const exitModel = async () => {
    setActiveFileId(null)
    setSelected(null)
    try {
      await fragsRef.current?.resetHighlight()
      await fragsRef.current?.core.update(true)
    } catch {}
  }

  // ---------- chat actions ----------
  const openConversation = (conv) => {
    setSelectedConv(conv)
    loadConvMessages(conv.id)
  }

  const sendConvMessage = async () => {
    if (!newConvMessage.trim() || !selectedConv) return
    const sel = selectedRef.current
    try {
      await axios.post(`${API}/conversations/${selectedConv.id}/messages`, {
        message: newConvMessage,
        element_id: sel?.elementId ?? -1,
        element_name: sel?.elementName ?? null,
        file_id: effectiveFileId()
      }, { headers })
      setNewConvMessage('')
      loadConvMessages(selectedConv.id)
    } catch (err) { alert('Send failed: ' + (err.response?.data?.error || err.message)) }
  }

  const leaveConversation = async () => {
    if (!selectedConv) return
    if (!confirm('Leave this conversation?')) return
    try {
      await axios.delete(`${API}/conversations/${selectedConv.id}/members/${encodeURIComponent(userEmail)}`, { headers })
      setSelectedConv(null); setConvMessages([])
      loadConversations()
    } catch (err) { alert('Failed: ' + (err.response?.data?.error || err.message)) }
  }

  const convertMessageToTask = async (m) => {
    if (!confirm('Create a task from this message?')) return
    try {
      await axios.post(`${API}/tasks/from-message`, { message_id: m.id }, { headers })
      loadTasks()
      alert('Task created.')
    } catch (err) { alert('Failed: ' + (err.response?.data?.error || err.message)) }
  }

  const closeNewConvModal = () => {
    setShowNewConvModal(false)
    setNcType('dm'); setNcName(''); setNcMembers([])
    setNcLevel(federatedMode ? 'project' : 'model'); setNcFolderId('')
    setNcFileId(federatedMode ? '' : String(fileId))
  }

  const createConversation = async () => {
    if (ncType === 'group' && !ncName.trim()) { alert('Group name is required'); return }
    if (ncMembers.length === 0) { alert('Select at least one member'); return }
    if (ncType === 'dm' && ncMembers.length !== 1) { alert('A DM needs exactly one other person'); return }
    if (ncLevel === 'folder' && !ncFolderId) { alert('Select a folder'); return }
    if (ncLevel === 'model' && !ncFileId) { alert('Select a model'); return }

    const body = { project_id: projectId, type: ncType, level: ncLevel, members: ncMembers }
    if (ncType === 'group') body.name = ncName.trim()
    if (ncLevel === 'folder') body.folder_id = parseInt(ncFolderId)
    if (ncLevel === 'model') body.file_id = parseInt(ncFileId)

    try {
      const res = await axios.post(`${API}/conversations`, body, { headers })
      closeNewConvModal()
      const newId = res.data.conversation_id
      const list = (await axios.get(`${API}/conversations?project_id=${projectId}`, { headers })).data
      setConversations(list)
      const conv = list.find(c => c.id === newId)
      if (conv) openConversation(conv)
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message))
    }
  }

  // ---------- task actions ----------
  const createTask = async () => {
    if (!newTaskDesc.trim() || !projectName) return
    const sel = selectedRef.current
    try {
      await axios.post(`${API}/tasks`, {
        id: crypto.randomUUID(),
        project_name: projectName,
        description: newTaskDesc,
        assignee: newTaskAssignee || '',
        created_by: userEmail || '',
        element_id: sel?.elementId ?? -1,
        element_name: sel?.elementName ?? '',
        view_name: '',
        status: 'Open',
        file_id: effectiveFileId()
      }, { headers })
      setNewTaskDesc(''); setNewTaskAssignee(''); setShowNewTask(false)
      loadTasks()
    } catch (err) { alert('Create failed: ' + (err.response?.data?.error || err.message)) }
  }

  const updateTaskStatus = async (taskId, status) => {
    try {
      await axios.put(`${API}/tasks/${taskId}`, { status }, { headers })
      loadTasks()
    } catch (err) { alert('Update failed: ' + (err.response?.data?.error || err.message)) }
  }

  const statusColor = (s) =>
    s === 'Open' ? '#E74C3C' : s === 'InProgress' ? '#F39C12' : '#27AE60'

  useEffect(() => {
    if (showProps && selected && selected.localId != null) {
      loadProperties()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.localId, selected?.ifcGuid])

  // ---------- element properties (IFC psets) ----------
  const asArray = (x) => Array.isArray(x) ? x : (x ? [x] : [])
  const attrVal = (a) => (a && typeof a === 'object' && 'value' in a) ? a.value : a
  const fmtVal = (v) => {
    if (v === null || v === undefined || v === '') return '—'
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3)
    return String(v)
  }

  const parseItemData = (data) => {
    const attributes = []
    const psets = []
    if (!data) return { attributes, psets }
    for (const key of Object.keys(data)) {
      if (key === 'IsDefinedBy' || key === 'DefinesOcurrence') continue
      const val = data[key]
      if (val && typeof val === 'object' && 'value' in val && !Array.isArray(val)) {
        attributes.push({ name: key, value: fmtVal(val.value) })
      }
    }
    for (const rel of asArray(data.IsDefinedBy)) {
      for (const pset of asArray(rel?.RelatingPropertyDefinition || rel)) {
        const psetName = attrVal(pset?.Name) || 'Property Set'
        const list = []
        for (const p of asArray(pset?.HasProperties)) {
          const pname = attrVal(p?.Name)
          const pval = attrVal(p?.NominalValue)
          if (pname != null) list.push({ name: String(pname), value: fmtVal(pval) })
        }
        if (list.length) psets.push({ name: String(psetName), props: list })
      }
    }
    return { attributes, psets }
  }

  const loadProperties = async () => {
    const sel = selectedRef.current
    if (!sel || sel.localId == null) return
    const model = fragsRef.current?.list.get(sel.modelId) || modelRef.current
    if (!model) return
    setShowProps(true)
    setLoadingProps(true)
    setProps(null)
    try {
      const [data] = await model.getItemsData([sel.localId], {
        attributesDefault: true,
        relations: {
          IsDefinedBy: { attributes: true, relations: true },
          DefinesOcurrence: { attributes: false, relations: false },
        },
      })
      setProps(parseItemData(data))
    } catch (e) {
      console.warn('properties failed:', e)
      setProps({ attributes: [], psets: [] })
    }
    setLoadingProps(false)
  }

  // ---------- conversation display helpers ----------
  const memberName = (email) => {
    const m = (projectMembers || []).find(x => x.user_email === email)
    if (m?.full_name) return m.full_name
    const u = users.find(x => x.email === email)
    return u?.full_name || email
  }

  const normLevel = (conv) => (LEVEL_META[conv.level] ? conv.level : 'project')

  const convTitle = (conv) => {
    if (conv.type === 'group') return conv.name || 'Group'
    const others = (conv.members || []).filter(e => e !== userEmail)
    return others.map(memberName).join(', ') || 'Direct message'
  }

  const convLevelName = (conv) => {
    if (conv.level === 'folder') {
      const f = folders.find(x => x.id === conv.folder_id)
      return f ? f.name : 'Folder'
    }
    if (conv.level === 'model') {
      const file = (projectFiles || []).find(x => x.id === conv.file_id)
      return file ? file.file_name : 'Model'
    }
    return 'Project'
  }

  const convLevelLabel = (conv) => {
    if (conv.level === 'folder') {
      const f = folders.find(x => x.id === conv.folder_id)
      return f ? `📁 ${f.name}` : '📁 Folder'
    }
    if (conv.level === 'model') {
      const file = (projectFiles || []).find(x => x.id === conv.file_id)
      return file ? `🧊 ${file.file_name}` : '🧊 Model'
    }
    return '🌐 Project'
  }

  // Folder chain (folder + all ancestors) of a given file
  const folderChainOf = (fid) => {
    const set = new Set()
    const file = (projectFiles || []).find(f => f.id === fid)
    let cur = file?.folder_id ?? null
    let guard = 0
    while (cur && guard < 10) {
      set.add(cur)
      const parent = folders.find(f => f.id === cur)
      cur = parent ? parent.parent_id : null
      guard++
    }
    return set
  }

  // Context filter: union of folder chains of ALL open models (so models from
  // Architecture + Structure both show their folder conversations). Model-level
  // conversations show only for the model you've entered (activeFileId).
  const folderScope = (() => {
    const set = new Set()
    const ids = federatedMode ? modelList.map(m => m.id) : [fileId]
    for (const fid of ids) for (const x of folderChainOf(fid)) set.add(x)
    return set
  })()

  const isConvVisible = (conv) => {
    const lvl = normLevel(conv)
    if (lvl === 'project') return true
    if (lvl === 'folder') return folderScope.has(conv.folder_id)
    if (lvl === 'model') {
      if (federatedMode) return activeFileId != null && conv.file_id === activeFileId
      return conv.file_id === fileId
    }
    return true
  }

  const projectMembersExceptMe = (projectMembers || []).filter(m => m.user_email !== userEmail)

  // models offered in the "new conversation" model dropdown
  const modelOptions = federatedMode
    ? modelList.map(m => ({ id: m.id, file_name: m.name }))
    : (projectFiles || [])

  // ---------- UI ----------
  const ElementLink = ({ elementId, fileId: linkFileId, name, className = '' }) => {
    const clickable = elementId && elementId !== -1
    if (clickable) {
      return (
        <button onClick={() => focusElement(elementId, linkFileId)}
          className={`text-blue-600 text-xs font-medium hover:underline text-left ${className}`}
          title="Show in 3D">
          🔗 {name}
        </button>
      )
    }
    return <div className={`text-blue-600 text-xs font-medium ${className}`}>🔗 {name}</div>
  }

  const TabButton = ({ id, label }) => (
    <button onClick={() => setActiveTab(id)}
      className={`flex-1 py-2 text-sm font-medium ${activeTab === id
        ? 'bg-blue-700 text-white' : 'bg-white text-blue-700 hover:bg-blue-50'}`}>
      {label}
    </button>
  )

  const ElementChip = () => selected && (
    <div className="px-3 py-2 border-t bg-blue-50 flex items-center justify-between text-sm">
      <span className="text-blue-700 truncate">🔗 {selected.elementName || selected.name}</span>
      <button onClick={() => setSelected(null)}
        className="text-gray-500 hover:text-gray-700 text-xs ml-2">clear</button>
    </div>
  )

  const ConversationList = () => {
    const visible = conversations.filter(isConvVisible)
    if (visible.length === 0) {
      return <p className="text-gray-400 text-sm text-center py-8 px-3">No conversations for this context yet. Start one with “+ New”.</p>
    }
    const sorted = [...visible].sort((a, b) => {
      const oa = LEVEL_META[normLevel(a)].order
      const ob = LEVEL_META[normLevel(b)].order
      if (oa !== ob) return oa - ob
      const da = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const db = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return db - da
    })

    const ConvRow = (conv) => {
      const meta = LEVEL_META[normLevel(conv)]
      return (
        <div key={conv.id} onClick={() => openConversation(conv)}
          className={`pl-2.5 pr-3 py-2.5 cursor-pointer border-b border-l-4 ${meta.border} bg-white hover:bg-gray-50 transition`}>
          <div className="flex items-center gap-2">
            <span className="text-base">{conv.type === 'group' ? '👥' : '👤'}</span>
            <span className="flex-1 font-medium text-sm text-gray-800 truncate">{convTitle(conv)}</span>
            {conv.last_message_at && (
              <span className="text-[10px] text-gray-400 flex-shrink-0">{new Date(conv.last_message_at).toLocaleDateString()}</span>
            )}
          </div>
          <div className="mt-1 ml-7">
            <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.badge}`}>
              {meta.icon} {convLevelName(conv)}
            </span>
          </div>
        </div>
      )
    }

    return ['project', 'folder', 'model'].map(lvl => {
      const items = sorted.filter(c => normLevel(c) === lvl)
      if (items.length === 0) return null
      const meta = LEVEL_META[lvl]
      return (
        <div key={lvl}>
          <div className="px-3 py-1.5 bg-gray-100 border-b sticky top-0 z-10">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              {meta.icon} {meta.header}
            </span>
          </div>
          {items.map(ConvRow)}
        </div>
      )
    })
  }

  return (
    <div className="fixed top-[72px] bottom-0 right-0 left-56 z-40 bg-gray-900 flex flex-col">
      <style>{`[data-thatopen-logo] { display: none !important; }`}</style>

      <div className="flex flex-1 min-h-0">
        {/* 3D viewport */}
        <div className="flex-1 relative">
          <div ref={containerRef} className="absolute inset-0" />

          {/* close button (top-left) */}
          <button onClick={onClose}
            className="absolute top-4 left-4 z-10 bg-white/90 hover:bg-white text-gray-700 px-3 py-1.5 rounded shadow text-sm">
            ✕ Close 3D
          </button>

          {/* federated status bar */}
          {federatedMode && status === 'ready' && (
            <div className="absolute top-4 left-32 z-10 flex items-center gap-2">
              <div className="bg-white/90 rounded shadow px-3 py-1.5 text-sm text-gray-700">
                🗂 {modelList.length} models
              </div>
              {activeFileId != null ? (
                <div className="bg-blue-700 text-white rounded shadow px-3 py-1.5 text-sm flex items-center gap-2">
                  <span className="truncate max-w-[160px]">In: {nameOfFile(activeFileId)}</span>
                  <button onClick={exitModel} className="hover:bg-blue-800 rounded px-1.5 -mr-1">Exit</button>
                </div>
              ) : (
                <div className="bg-amber-100 text-amber-800 rounded shadow px-3 py-1.5 text-sm">
                  Click an element to enter a model
                </div>
              )}
            </div>
          )}

          {/* visualization toolbar (top-right) */}
          {status === 'ready' && (
            <div className="absolute top-4 right-4 flex flex-col gap-1.5 items-end">
              <button onClick={applySectionBox} title="Section box around selected element"
                className={`w-9 h-9 rounded shadow flex items-center justify-center text-base ${sectionActive
                  ? 'bg-blue-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>
                ⬚
              </button>
              <button onClick={toggleClipMode} title="Create a cutting plane (click a surface)"
                className={`w-9 h-9 rounded shadow flex items-center justify-center ${clipMode
                  ? 'bg-blue-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.6">
                  <circle cx="12" cy="12" r="6.5" />
                  <path d="M12 5.5 L15 11 L9 11 Z" fill="currentColor" stroke="none" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                </svg>
              </button>
              <button onClick={togglePlanesVisible} title={planesVisible ? 'Hide cut planes' : 'Show cut planes'}
                className={`w-9 h-9 rounded shadow flex items-center justify-center text-base ${!planesVisible
                  ? 'bg-blue-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>
                {planesVisible ? '👁️' : '🙈'}
              </button>
              <button onClick={deleteAllClips} title="Delete all cutting planes"
                className="w-9 h-9 rounded shadow flex items-center justify-center text-base bg-white text-gray-700 hover:bg-gray-100">
                🗑
              </button>
              <button onClick={clearSectionBox} title="Exit section box"
                className="w-9 h-9 rounded shadow flex items-center justify-center text-base bg-white text-gray-700 hover:bg-gray-100">
                ⊗
              </button>

              {clipMode && (
                <div className="bg-black/60 text-white text-[11px] px-2 py-1 rounded max-w-[160px] text-right mt-1">
                  Click a surface to cut
                </div>
              )}
            </div>
          )}

          {status === 'ready' && selected && (
            <div className="absolute top-16 left-4 w-72 flex flex-col gap-2">
              <div className="bg-white rounded-lg shadow-lg p-3 text-sm">
                <p className="font-semibold text-gray-800 mb-1">Selected element</p>
                {federatedMode && selected.fileId != null && (
                  <p className="text-gray-700"><span className="text-gray-500">Model:</span> {nameOfFile(selected.fileId)}</p>
                )}
                <p className="text-gray-700"><span className="text-gray-500">Name:</span> {selected.name}</p>
                {selected.elementId > 0 && (
                  <p className="text-gray-700"><span className="text-gray-500">Element ID:</span> {selected.elementId}</p>
                )}
                <button onClick={loadProperties}
                  className="mt-2 bg-blue-700 hover:bg-blue-800 text-white px-2 py-1 rounded text-xs">
                  📋 Properties
                </button>
                {sectionActive && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Box size</span>
                      <span>{sectionPad.toFixed(1)} m</span>
                    </div>
                    <input type="range" min="-0.4" max="5" step="0.1" value={sectionPad}
                      onChange={e => onSectionPadChange(parseFloat(e.target.value))}
                      className="w-full accent-blue-700" />
                  </div>
                )}
              </div>

              {showProps && (
                <div className="bg-white rounded-lg shadow-lg max-h-[70vh] overflow-y-auto text-sm">
                  <div className="flex justify-between items-center px-3 py-2 border-b sticky top-0 bg-white">
                    <span className="font-semibold text-gray-800">Properties</span>
                    <button onClick={() => setShowProps(false)}
                      className="text-gray-500 hover:text-gray-700 text-xs">✕</button>
                  </div>
                  {loadingProps && <p className="px-3 py-3 text-gray-500">Loading...</p>}
                  {!loadingProps && props && (
                    <div className="px-3 py-2">
                      {props.attributes.length > 0 && (
                        <div className="mb-2">
                          <p className="font-semibold text-gray-700 text-xs uppercase mb-1">Attributes</p>
                          {props.attributes.map((a, i) => (
                            <div key={i} className="flex justify-between gap-2 py-0.5 border-b border-gray-100">
                              <span className="text-gray-500 flex-shrink-0">{a.name}</span>
                              <span className="text-gray-800 text-right break-all">{a.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {props.psets.map((ps, i) => (
                        <details key={i} className="mb-1" open>
                          <summary className="cursor-pointer font-semibold text-gray-700 text-xs py-1">
                            {ps.name}
                          </summary>
                          <div className="pl-1">
                            {ps.props.map((p, j) => (
                              <div key={j} className="flex justify-between gap-2 py-0.5 border-b border-gray-100">
                                <span className="text-gray-500 flex-shrink-0">{p.name}</span>
                                <span className="text-gray-800 text-right break-all">{p.value}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      ))}
                      {props.attributes.length === 0 && props.psets.length === 0 && (
                        <p className="text-gray-500 py-2">No properties found.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {status === 'ready' && !selected && sectionActive && (
            <button onClick={clearSectionBox}
              className="absolute top-4 left-4 bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded text-xs shadow">
              ✕ Clear section
            </button>
          )}

          {/* right-click context menu */}
          {contextMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
              <div className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 text-sm w-48"
                style={{ left: contextMenu.x, top: contextMenu.y }}>
                {selected && (
                  <>
                    <button onClick={isolateSelected}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100">🔆 Isolate</button>
                    <button onClick={hideSelected}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100">🚫 Hide</button>
                    <button onClick={() => { applySectionBox(); setContextMenu(null) }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100">✂️ Section box</button>
                    <div className="border-t my-1" />
                  </>
                )}
                <button onClick={deleteClipHere}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100">🗑 Delete cut here</button>
                <button onClick={showAll}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100">👁️ Show all</button>
              </div>
            </>
          )}

          {status === 'ready' && !selected && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
              {federatedMode ? 'Click an element to enter its model · double-click empty space to exit' : 'Click an element to link it'}
            </div>
          )}

          {status !== 'ready' && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-center px-6">
              {status === 'loading' && <p>Loading...</p>}
              {status === 'pending' && (
                <div>
                  <div className="animate-spin h-8 w-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-3" />
                  <p>Model is being prepared (conversion in progress)...</p>
                  <p className="text-sm text-gray-300 mt-1">It will open automatically.</p>
                </div>
              )}
              {status === 'none' && (
                <p>This model has not been sent to Web yet.<br />Open it in Revit and click the "Web" button.</p>
              )}
              {status === 'error' && <p className="text-red-300">Error: {errorMsg}</p>}
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="w-96 bg-white flex flex-col border-l border-gray-200">
          <div className="flex border-b">
            <TabButton id="tasks" label="📋 Tasks" />
            <TabButton id="chat" label="💬 Chat" />
          </div>

          {/* CHAT */}
          {activeTab === 'chat' && (
            selectedConv ? (
              <>
                <div className="px-3 py-2 border-b bg-blue-700 flex items-center gap-2">
                  <button onClick={() => { setSelectedConv(null); setConvMessages([]) }}
                    className="text-white text-lg leading-none">←</button>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">
                      {selectedConv.type === 'group' ? '👥' : '👤'} {convTitle(selectedConv)}
                    </p>
                    <p className="text-blue-200 text-[11px] truncate">
                      {convLevelLabel(selectedConv)}
                      {selectedConv.type === 'group' && ` · ${(selectedConv.members || []).length} members`}
                    </p>
                  </div>
                  <button onClick={leaveConversation}
                    className="text-blue-100 hover:text-white text-xs border border-blue-400 rounded px-2 py-1">Leave</button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {convMessages.map(m => (
                    <div key={m.id} className="flex flex-col group">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-6 h-6 bg-blue-700 rounded-full flex items-center justify-center text-white text-xs font-bold">
                          {m.sender?.[0]?.toUpperCase() || '?'}
                        </div>
                        <span className="text-xs font-medium text-blue-700">{memberName(m.sender)}</span>
                        <span className="text-xs text-gray-400">{new Date(m.created_at).toLocaleTimeString()}</span>
                        <button onClick={() => convertMessageToTask(m)}
                          className="opacity-0 group-hover:opacity-100 transition text-[11px] text-gray-500 hover:text-blue-700 border border-gray-200 rounded px-1.5 py-0.5"
                          title="Convert to task">→ Task</button>
                      </div>
                      <div className="ml-8 bg-gray-100 rounded-lg px-3 py-2 text-sm">
                        {m.message}
                        {m.element_name && (
                          <ElementLink elementId={m.element_id} fileId={m.file_id} name={m.element_name} className="mt-1 block" />
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                <ElementChip />
                <div className="p-3 border-t flex gap-2 items-center">
                  <input value={newConvMessage} onChange={e => setNewConvMessage(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendConvMessage()}
                    placeholder={selected ? 'Message about this element...' : 'Type a message...'}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button onClick={sendConvMessage}
                    className="bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-800">Send</button>
                </div>
              </>
            ) : (
              <>
                <div className="px-3 py-2 border-b flex justify-between items-center">
                  <span className="font-semibold text-gray-700 text-sm">Chat</span>
                  <button onClick={() => setShowNewConvModal(true)}
                    className="bg-blue-700 hover:bg-blue-800 text-white px-2.5 py-1 rounded-lg text-xs">+ New</button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <ConversationList />
                </div>
              </>
            )
          )}

          {/* TASKS */}
          {activeTab === 'tasks' && (
            <>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {tasks.map(t => (
                  <div key={t.id} className="border border-gray-200 rounded-lg p-2">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full inline-block"
                        style={{ backgroundColor: statusColor(t.status) }} />
                      <span className="font-medium text-sm flex-1">{t.description}</span>
                    </div>
                    {t.assignee && <p className="text-xs text-gray-500 ml-5">→ {t.assignee}</p>}
                    {t.element_name && t.element_id !== -1 && (
                      <div className="ml-5"><ElementLink elementId={t.element_id} fileId={t.file_id} name={t.element_name} /></div>
                    )}
                    <div className="ml-5 mt-1">
                      <select value={t.status} onChange={e => updateTaskStatus(t.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded px-1 py-0.5">
                        <option value="Open">Open</option>
                        <option value="InProgress">In Progress</option>
                        <option value="Closed">Closed</option>
                      </select>
                    </div>
                  </div>
                ))}
                {tasks.length === 0 && <p className="text-sm text-gray-400 text-center mt-4">No tasks yet.</p>}
              </div>

              {showNewTask ? (
                <div className="border-t p-3 space-y-2">
                  <input value={newTaskDesc} onChange={e => setNewTaskDesc(e.target.value)}
                    placeholder="Task description..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">Assign to... (optional)</option>
                    {users.map(u => <option key={u.email} value={u.email}>{u.full_name || u.email}</option>)}
                  </select>
                  {selected && (
                    <div className="text-blue-700 text-sm">🔗 {selected.elementName || selected.name}</div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={createTask}
                      className="flex-1 bg-blue-700 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-800">Create</button>
                    <button onClick={() => { setShowNewTask(false); setNewTaskDesc(''); setNewTaskAssignee('') }}
                      className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="border-t p-3">
                  <button onClick={() => setShowNewTask(true)}
                    className="w-full bg-blue-700 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-800">
                    + New Task {selected ? '(linked to element)' : ''}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---------- NEW CONVERSATION MODAL ---------- */}
      {showNewConvModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">New conversation</h2>

            <div className="inline-flex bg-gray-200 rounded-lg p-1 mb-4">
              <button onClick={() => { setNcType('dm'); setNcMembers([]) }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${ncType === 'dm' ? 'bg-white text-blue-700 shadow' : 'text-gray-600'}`}>
                👤 Direct
              </button>
              <button onClick={() => { setNcType('group'); setNcMembers([]) }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${ncType === 'group' ? 'bg-white text-blue-700 shadow' : 'text-gray-600'}`}>
                👥 Group
              </button>
            </div>

            <div className="space-y-3">
              {ncType === 'group' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Group name *</label>
                  <input value={ncName} onChange={e => setNcName(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Structure team" />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {ncType === 'dm' ? 'Person *' : 'Members *'}
                </label>
                <div className="border border-gray-300 rounded-lg max-h-40 overflow-y-auto">
                  {projectMembersExceptMe.length === 0 ? (
                    <p className="text-xs text-gray-400 p-3">No other members in this project yet.</p>
                  ) : projectMembersExceptMe.map(m => {
                    const checked = ncMembers.includes(m.user_email)
                    return (
                      <label key={m.user_email}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm border-b last:border-b-0">
                        <input
                          type={ncType === 'dm' ? 'radio' : 'checkbox'}
                          name="conv-members"
                          checked={checked}
                          onChange={() => {
                            if (ncType === 'dm') setNcMembers([m.user_email])
                            else setNcMembers(prev => checked ? prev.filter(e => e !== m.user_email) : [...prev, m.user_email])
                          }} />
                        <span className="text-gray-800">{m.full_name || m.user_email}</span>
                        <span className="text-xs text-gray-400">{m.user_email}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Level (where it shows)</label>
                <select value={ncLevel}
                  onChange={e => {
                    const lvl = e.target.value
                    setNcLevel(lvl); setNcFolderId('')
                    setNcFileId(lvl === 'model'
                      ? String(activeFileId ?? (federatedMode ? (modelList[0]?.id ?? '') : fileId))
                      : '')
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="project">🌐 Project — visible everywhere</option>
                  <option value="folder">📁 Folder/Discipline</option>
                  <option value="model">🧊 Model</option>
                </select>
              </div>

              {ncLevel === 'folder' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Folder *</label>
                  <select value={ncFolderId} onChange={e => setNcFolderId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">Select folder...</option>
                    {folders.map(f => {
                      const parent = f.parent_id ? folders.find(p => p.id === f.parent_id) : null
                      return <option key={f.id} value={f.id}>{parent ? `${parent.name} / ${f.name}` : f.name}</option>
                    })}
                  </select>
                </div>
              )}

              {ncLevel === 'model' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Model *</label>
                  <select value={ncFileId} onChange={e => setNcFileId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">Select model...</option>
                    {modelOptions.map(f => (
                      <option key={f.id} value={f.id}>{f.file_name}{f.id === activeFileId ? ' (active)' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={closeNewConvModal}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>
              <button onClick={createConversation}
                className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}