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

// 3D viewer + side panel (Tasks | Chat). The scene is "live": models can be
// added/removed at any time (driven by `files` from the dashboard sidebar).
// The 3D world is built ONCE; a separate effect loads/disposes models as `files`
// changes, so toggling a model does not rebuild the whole viewer.
//
// Active-model rule (Opsioni A): clicking an element only SELECTS it (highlight,
// properties, link). It does NOT change the chat context. You "enter" a model
// explicitly: double-click a model (or pick it in the "Active model" dropdown).
// Double-click empty space exits to project/folder context.
function emailFromToken(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(decodeURIComponent(escape(atob(part))))
    return payload.email || null
  } catch { return null }
}

export default function Viewer({
  files = [], projectName, projectId,
  folders = [], projectFiles = [], projectMembers = [],
  token, userEmail: userEmailProp, onClose
}) {
  const userEmail = userEmailProp || emailFromToken(token)

  const modelList = Array.isArray(files) ? files : []
  const filesKey = modelList.map(m => m.id).join(',')
  const multi = modelList.length > 1

  const containerRef = useRef(null)
  const componentsRef = useRef(null)
  const fragsRef = useRef(null)
  const worldRef = useRef(null)
  const casterRef = useRef(null)
  const clipperRef = useRef(null)
  const chatEndRef = useRef(null)

  const modelIdToFileIdRef = useRef({})   // 'file-12' -> 12
  const loadedModelIdsRef = useRef(new Set())
  const baseChildrenRef = useRef([])      // grid/lights present before any model
  const syncRunningRef = useRef(false)
  const syncPendingRef = useRef(false)
  const filesRef = useRef(modelList)
  useEffect(() => { filesRef.current = modelList }, [filesKey])

  const fileIdOfModelId = (mId) => modelIdToFileIdRef.current[mId]
  const nameOfFile = (fid) =>
    (filesRef.current.find(m => m.id === fid)?.name) ||
    (projectFiles || []).find(f => f.id === fid)?.file_name || 'Model'

  const [worldReady, setWorldReady] = useState(false)
  const [firstSync, setFirstSync] = useState(false)
  const [modelStatus, setModelStatus] = useState({}) // fileId -> 'pending'|'ready'|'error'
  const [errorMsg, setErrorMsg] = useState('')

  const [selected, setSelected] = useState(null) // { name, ifcGuid, elementId, elementName, localId, modelId, fileId }
  const selectedRef = useRef(null)
  useEffect(() => { selectedRef.current = selected }, [selected])

  // whole-model selection (federated view, before entering any model)
  const [selectedModel, setSelectedModel] = useState(null) // { fileId, modelId, name }
  const selBoxRef = useRef(null)        // THREE.Box3Helper for the selected model
  const dimStateRef = useRef(new Map()) // mesh.uuid -> { mesh, original material }

  // which model is "entered" (active chat context). Default: the only model if
  // there is exactly one, otherwise none (project/folder context).
  const [activeFileId, setActiveFileId] = useState(modelList.length === 1 ? modelList[0].id : null)
  const activeFileIdRef = useRef(activeFileId)
  useEffect(() => { activeFileIdRef.current = activeFileId }, [activeFileId])

  const [activeTab, setActiveTab] = useState('chat') // chat | tasks
  const [sectionActive, setSectionActive] = useState(false)
  const [sectionPad, setSectionPad] = useState(0.6)
  const sectionBaseBoxRef = useRef(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [clipMode, setClipMode] = useState(false)
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
  const [ncLevel, setNcLevel] = useState(modelList.length === 1 ? 'model' : 'project')
  const [ncFolderId, setNcFolderId] = useState('')
  const [ncFileId, setNcFileId] = useState(modelList.length === 1 ? String(modelList[0].id) : '')

  // tasks
  const [tasks, setTasks] = useState([])
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')

  const headers = { Authorization: `Bearer ${token}` }
  const pn = encodeURIComponent(projectName || '')

  // effective file id for new messages / tasks: the selected element's model,
  // else the active model. (Element links keep their own model regardless.)
  const effectiveFileId = () =>
    selectedRef.current?.fileId ?? activeFileIdRef.current ?? (modelList.length === 1 ? modelList[0].id : null)

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
      const tfid = activeFileId ?? (modelList.length === 1 ? modelList[0].id : null)
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
    if (!worldReady) return
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
  }, [worldReady, activeTab, selectedConv, projectId, activeFileId])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [convMessages])

  // ---------- camera fit over all loaded models ----------
  const fitToLoaded = async () => {
    const world = worldRef.current
    const fragments = fragsRef.current
    if (!world || !fragments) return
    try {
      const box = new THREE.Box3()
      let any = false
      for (const [, model] of fragments.list) {
        if (model?.object) { box.expandByObject(model.object); any = true }
      }
      if (!any) return
      const center = new THREE.Vector3()
      const size = new THREE.Vector3()
      box.getCenter(center)
      box.getSize(size)
      const radius = Math.max(size.x, size.y, size.z) || 10
      const d = radius * 1.6
      await world.camera.controls.setLookAt(
        center.x + d, center.y + d, center.z + d,
        center.x, center.y, center.z, false
      )
      const sphere = new THREE.Sphere()
      box.getBoundingSphere(sphere)
      if (sphere.radius > 0) await world.camera.controls.fitToSphere(sphere, true)
    } catch (e) { console.warn('fit failed', e) }
  }

  // ---------- whole-model selection box (Revit-group style) ----------
  const clearModelBox = () => {
    const world = worldRef.current
    if (selBoxRef.current) {
      try { world?.scene.three.remove(selBoxRef.current) } catch {}
      try { selBoxRef.current.geometry?.dispose?.() } catch {}
      selBoxRef.current = null
    }
  }

  const showModelBox = (modelId) => {
    const world = worldRef.current
    const fragments = fragsRef.current
    if (!world || !fragments) return
    clearModelBox()
    const model = fragments.list.get(modelId)
    if (!model?.object) return
    try {
      const box = new THREE.Box3().setFromObject(model.object)
      if (box.isEmpty()) return
      const helper = new THREE.Box3Helper(box, new THREE.Color('#3b82f6'))
      helper.userData.__bimchatKeep = true   // don't let the ghost-cleaner remove it
      world.scene.three.add(helper)
      selBoxRef.current = helper
    } catch (e) { console.warn('model box failed', e) }
  }

  // ---------- dim non-active models (ghosting) ----------
  // Clones each affected mesh's material so dimming one model never bleeds into
  // another (That Open can share materials). Restored on un-dim.
  const setModelDimmed = (modelId, dim) => {
    const model = fragsRef.current?.list.get(modelId)
    if (!model?.object) return
    model.object.traverse(o => {
      if (!o.isMesh) return
      if (dim) {
        if (dimStateRef.current.has(o.uuid)) return
        const orig = o.material
        const arr = Array.isArray(orig) ? orig : [orig]
        const clones = arr.map(m => {
          const c = m.clone()
          c.transparent = true
          c.opacity = 0.8
          c.depthWrite = false
          return c
        })
        dimStateRef.current.set(o.uuid, { mesh: o, original: orig })
        o.material = Array.isArray(orig) ? clones : clones[0]
      } else {
        const saved = dimStateRef.current.get(o.uuid)
        if (!saved) return
        const cur = o.material
        const curArr = Array.isArray(cur) ? cur : [cur]
        o.material = saved.original
        curArr.forEach(c => { try { c.dispose?.() } catch {} })
        dimStateRef.current.delete(o.uuid)
      }
    })
  }

  const applyDim = (activeFid) => {
    const fragments = fragsRef.current
    if (!fragments) return
    for (const [modelId] of fragments.list) {
      const fid = modelIdToFileIdRef.current[modelId]
      setModelDimmed(modelId, activeFid != null && fid !== activeFid)
    }
    try { fragments.core.update(true) } catch {}
  }

  // when the active model changes, reset selection, redraw the box, re-dim
  useEffect(() => {
    if (!worldReady) return
    clearModelBox()
    setSelectedModel(null)
    setSelected(null)
    ;(async () => {
      try { await fragsRef.current?.resetHighlight() } catch {}
      applyDim(activeFileId)
      try { await fragsRef.current?.core.update(true) } catch {}
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId, worldReady])

  // ===================================================================
  // EFFECT A — build the 3D world ONCE (no model loading here)
  // ===================================================================
  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false

    const build = async () => {
      try {
        const components = new OBC.Components()
        componentsRef.current = components

        const worlds = components.get(OBC.Worlds)
        const world = worlds.create()
        world.scene = new OBC.SimpleScene(components)
        world.renderer = new OBC.SimpleRenderer(components, containerRef.current)
        world.camera = new OBC.OrthoPerspectiveCamera(components)

        // Mouse like Revit: middle = pan, wheel = zoom
        try {
          const ctrls = world.camera.controls
          ctrls.mouseButtons.left = 1
          ctrls.mouseButtons.middle = 2
          ctrls.mouseButtons.right = 0
          ctrls.mouseButtons.wheel = 16
        } catch {}

        components.init()
        world.scene.setup()
        world.scene.three.background = null

        const grids = components.get(OBC.Grids)
        grids.create(world)

        // snapshot the "furniture" (grid, lights) so we can detect stray model
        // meshes later and clear ghosts on removal
        baseChildrenRef.current = [...world.scene.three.children]

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
        // add a model to the scene as soon as it is loaded
        fragments.list.onItemSet.add(({ value: model }) => {
          model.useCamera(world.camera.three)
          world.scene.three.add(model.object)
          fragments.core.update(true)
        })
        // remove a model's object from the scene when it is disposed
        fragments.list.onItemDeleted.add((ev) => {
          try {
            const obj = ev?.value?.object
            if (obj) world.scene.three.remove(obj)
          } catch {}
        })
        fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
          if (!('isLodMaterial' in material && material.isLodMaterial)) {
            material.polygonOffset = true
            material.polygonOffsetUnits = 1
            material.polygonOffsetFactor = Math.random()
          }
        })

        // raycaster + element selection (does NOT change active model)
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
            const activeFid = activeFileIdRef.current

            // empty space -> clear element + whole-model selection
            if (!result) {
              await fragments.resetHighlight()
              await fragments.core.update(true)
              setSelected(null)
              setSelectedModel(null)
              clearModelBox()
              return
            }

            const mId = result.fragments.modelId
            const localId = result.localId
            const model = fragments.list.get(mId)
            if (!model) return
            const clickedFileId = fileIdOfModelId(mId)

            // CASE 1 — no model entered: select the WHOLE clicked model (Revit-group style)
            if (activeFid == null) {
              await fragments.resetHighlight()
              await fragments.core.update(true)
              setSelected(null)
              setSelectedModel({ fileId: clickedFileId, modelId: mId, name: nameOfFile(clickedFileId) })
              showModelBox(mId)
              return
            }

            // CASE 2 — inside a model: ignore clicks on OTHER models
            if (clickedFileId !== activeFid) return

            // CASE 3 — element selection within the active model
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
            if (ifcGuid && clickedFileId != null) {
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
          } catch (e) { console.error('select error:', e) }
        }
        containerRef.current.addEventListener('click', onClick)

        // double-click = explicit model enter/exit
        const onDblClick = async () => {
          if (clipModeRef.current) return
          try {
            const result = await caster.castRay()
            if (result) {
              const fid = fileIdOfModelId(result.fragments.modelId)
              if (fid != null) setActiveFileId(fid)            // enter that model
            } else if (filesRef.current.length > 1) {
              setActiveFileId(null)                            // exit to project/folder
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

        components._onClick = onClick
        components._onDblClick = onDblClick
        components._onContextMenu = onContextMenu
        components._container = containerRef.current

        if (!disposed) setWorldReady(true)
      } catch (err) {
        console.error('World build error:', err)
        if (!disposed) { setErrorMsg(err.message || 'Failed to start 3D.'); setWorldReady(true); setFirstSync(true) }
      }
    }

    build()
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
      loadedModelIdsRef.current = new Set()
      modelIdToFileIdRef.current = {}
    }
  }, [])

  // ===================================================================
  // EFFECT B — sync loaded models with `files` (live add / remove)
  // ===================================================================
  useEffect(() => {
    if (!worldReady) return
    let cancelled = false
    let retry = null

    // Remove any mesh left in the scene that is NOT base furniture and NOT
    // backed by a currently-loaded model (kills "ghost" leftovers after dispose).
    const clearStrayObjects = () => {
      const world = worldRef.current
      const fragments = fragsRef.current
      if (!world || !fragments) return
      const base = new Set(baseChildrenRef.current)
      const keep = new Set()
      for (const [, model] of fragments.list) { if (model?.object) keep.add(model.object) }
      for (const child of [...world.scene.three.children]) {
        if (base.has(child) || keep.has(child) || child.userData?.__bimchatKeep) continue
        try {
          world.scene.three.remove(child)
          child.traverse?.(o => { try { o.geometry?.dispose?.() } catch {} })
        } catch {}
      }
    }

    const sync = async () => {
      // serialize: never run two syncs at once (fast toggling caused ghosts)
      if (syncRunningRef.current) { syncPendingRef.current = true; return }
      syncRunningRef.current = true
      try {
        const fragments = fragsRef.current
        const world = worldRef.current
        if (!fragments || !world) return

        const want = filesRef.current               // latest list (not stale closure)
        const desired = new Set(want.map(f => `file-${f.id}`))
        const loaded = loadedModelIdsRef.current

        // remove models no longer desired
        for (const modelId of [...loaded]) {
          if (!desired.has(modelId)) {
            try {
              const m = fragments.list.get(modelId)
              if (m?.object) world.scene.three.remove(m.object)
              await fragments.core.disposeModel(modelId)
            } catch (e) { console.warn('dispose failed', modelId, e) }
            loaded.delete(modelId)
            delete modelIdToFileIdRef.current[modelId]
          }
        }

        const wasEmpty = loaded.size === 0
        let addedAny = false
        let anyPending = false
        const statusUpdates = {}

        for (const f of want) {
          const modelId = `file-${f.id}`
          if (loaded.has(modelId)) { statusUpdates[f.id] = 'ready'; continue }
          try {
            const st = await axios.get(`${API}/web-export/${f.id}/status`, { headers })
            if (cancelled) return
            if (!(st.data.status === 'ready' && st.data.hasFrag)) {
              statusUpdates[f.id] = st.data.status === 'error' ? 'error' : 'pending'
              if (st.data.status !== 'error') anyPending = true
              continue
            }
            const urlRes = await axios.get(`${API}/web-export/${f.id}/frag-url`, { headers })
            const fragUrl = urlRes.data.downloadUrl
            if (!fragUrl) { statusUpdates[f.id] = 'error'; continue }
            const resp = await fetch(fragUrl)
            if (!resp.ok) { statusUpdates[f.id] = 'error'; continue }
            const buffer = await resp.arrayBuffer()
            if (cancelled) return
            await fragments.core.load(buffer, { modelId })
            loaded.add(modelId)
            modelIdToFileIdRef.current[modelId] = f.id
            statusUpdates[f.id] = 'ready'
            addedAny = true
          } catch (e) {
            console.warn('load failed', f.id, e)
            statusUpdates[f.id] = 'error'
          }
        }

        if (cancelled) return
        clearStrayObjects()                     // wipe any ghost meshes
        await fragments.core.update(true)
        applyDim(activeFileIdRef.current)        // keep non-active models ghosted
        setModelStatus(prev => ({ ...prev, ...statusUpdates }))

        if (wasEmpty && addedAny) await fitToLoaded()
        setFirstSync(true)

        if (anyPending && !cancelled) retry = setTimeout(sync, 4000)
      } finally {
        syncRunningRef.current = false
        // if files changed while we were busy, run once more with the latest list
        if (syncPendingRef.current && !cancelled) { syncPendingRef.current = false; sync() }
      }
    }

    sync()
    return () => { cancelled = true; if (retry) clearTimeout(retry) }
  }, [worldReady, filesKey])

  // keep active model valid as `files` changes
  useEffect(() => {
    setActiveFileId(prev => {
      const ids = modelList.map(f => f.id)
      if (prev != null && !ids.includes(prev)) return ids.length === 1 ? ids[0] : null
      if (prev == null && ids.length === 1) return ids[0]
      return prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey])

  // ---------- focus an element from a stored link (element_id + file_id) ----------
  const focusElement = async (elementId, linkFileId) => {
    if (!elementId || elementId === -1) return
    const fragments = fragsRef.current
    if (!fragments) return
    const fid = linkFileId ?? activeFileIdRef.current ?? (modelList.length === 1 ? modelList[0].id : null)
    if (!fid) return
    const modelId = `file-${fid}`
    const model = fragments.list.get(modelId)
    if (!model) { alert('That model is not in the scene. Add it from the list first.'); return }

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
    await sectionBoxForLocalId(localId, modelId)
  }

  // ---------- section box ----------
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

  // ---------- hide / isolate ----------
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

  // ---------- manual clipping planes ----------
  const toggleClipMode = () => setClipMode(prev => !prev)
  const deleteAllClips = () => { try { clipperRef.current?.deleteAll() } catch {} }
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
    setNcLevel(modelList.length === 1 ? 'model' : 'project'); setNcFolderId('')
    setNcFileId(modelList.length === 1 ? String(modelList[0].id) : '')
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
    if (showProps && selected && selected.localId != null) loadProperties()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.localId, selected?.ifcGuid])

  // ---------- properties ----------
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
    const model = fragsRef.current?.list.get(sel.modelId)
    if (!model) return
    setShowProps(true); setLoadingProps(true); setProps(null)
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

  // project always; folder = union of folder chains of all models in scene;
  // model-level only for the model you've entered (activeFileId).
  const folderScope = (() => {
    const set = new Set()
    for (const f of modelList) for (const x of folderChainOf(f.id)) set.add(x)
    return set
  })()

  const isConvVisible = (conv) => {
    const lvl = normLevel(conv)
    if (lvl === 'project') return true
    if (lvl === 'folder') return folderScope.has(conv.folder_id)
    if (lvl === 'model') return activeFileId != null && conv.file_id === activeFileId
    return true
  }

  const projectMembersExceptMe = (projectMembers || []).filter(m => m.user_email !== userEmail)
  const modelOptions = modelList.map(m => ({ id: m.id, file_name: m.name }))

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

  const pendingCount = modelList.filter(f => modelStatus[f.id] === 'pending').length
  const overlayVisible = !worldReady || !firstSync

  return (
    <div className="fixed top-[72px] bottom-0 right-0 left-56 z-40 bg-gray-900 flex flex-col">
      <style>{`[data-thatopen-logo] { display: none !important; }`}</style>

      <div className="flex flex-1 min-h-0">
        {/* 3D viewport */}
        <div className="flex-1 relative">
          <div ref={containerRef} className="absolute inset-0" />

          {/* close button */}
          <button onClick={onClose}
            className="absolute top-4 left-4 z-10 bg-white/90 hover:bg-white text-gray-700 px-3 py-1.5 rounded shadow text-sm">
            ✕ Close 3D
          </button>

          {/* scene status bar */}
          <div className="absolute top-4 left-32 z-10 flex items-center gap-2">
            <div className="bg-white/90 rounded shadow px-3 py-1.5 text-sm text-gray-700">
              🗂 {modelList.length} model{modelList.length === 1 ? '' : 's'}
              {pendingCount > 0 && <span className="text-amber-600"> · {pendingCount} preparing…</span>}
            </div>
            {multi && (
              activeFileId != null ? (
                <div className="bg-blue-700 text-white rounded shadow px-3 py-1.5 text-sm flex items-center gap-2">
                  <span className="truncate max-w-[160px]">In: {nameOfFile(activeFileId)}</span>
                  <button onClick={() => setActiveFileId(null)} className="hover:bg-blue-800 rounded px-1.5 -mr-1">Exit</button>
                </div>
              ) : selectedModel ? (
                <div className="bg-blue-600 text-white rounded shadow px-3 py-1.5 text-sm flex items-center gap-2">
                  <span className="truncate max-w-[180px]">Model: {selectedModel.name}</span>
                  <button onClick={() => setActiveFileId(selectedModel.fileId)}
                    className="bg-white/20 hover:bg-white/30 rounded px-2 py-0.5 text-xs">Enter</button>
                </div>
              ) : (
                <div className="bg-amber-100 text-amber-800 rounded shadow px-3 py-1.5 text-sm">
                  Click a model to select · double-click to enter
                </div>
              )
            )}
          </div>

          {/* visualization toolbar */}
          {!overlayVisible && (
            <div className="absolute top-4 right-4 flex flex-col gap-1.5 items-end">
              <button onClick={applySectionBox} title="Section box around selected element"
                className={`w-9 h-9 rounded shadow flex items-center justify-center text-base ${sectionActive
                  ? 'bg-blue-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>⬚</button>
              <button onClick={toggleClipMode} title="Create a cutting plane (click a surface)"
                className={`w-9 h-9 rounded shadow flex items-center justify-center ${clipMode
                  ? 'bg-blue-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
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
                className="w-9 h-9 rounded shadow flex items-center justify-center text-base bg-white text-gray-700 hover:bg-gray-100">🗑</button>
              <button onClick={clearSectionBox} title="Exit section box"
                className="w-9 h-9 rounded shadow flex items-center justify-center text-base bg-white text-gray-700 hover:bg-gray-100">⊗</button>
              {clipMode && (
                <div className="bg-black/60 text-white text-[11px] px-2 py-1 rounded max-w-[160px] text-right mt-1">
                  Click a surface to cut
                </div>
              )}
            </div>
          )}

          {!overlayVisible && selected && (
            <div className="absolute top-16 left-4 w-72 flex flex-col gap-2">
              <div className="bg-white rounded-lg shadow-lg p-3 text-sm">
                <p className="font-semibold text-gray-800 mb-1">Selected element</p>
                {multi && selected.fileId != null && (
                  <p className="text-gray-700"><span className="text-gray-500">Model:</span> {nameOfFile(selected.fileId)}</p>
                )}
                <p className="text-gray-700"><span className="text-gray-500">Name:</span> {selected.name}</p>
                {selected.elementId > 0 && (
                  <p className="text-gray-700"><span className="text-gray-500">Element ID:</span> {selected.elementId}</p>
                )}
                <button onClick={loadProperties}
                  className="mt-2 bg-blue-700 hover:bg-blue-800 text-white px-2 py-1 rounded text-xs">📋 Properties</button>
                {sectionActive && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Box size</span><span>{sectionPad.toFixed(1)} m</span>
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
                    <button onClick={() => setShowProps(false)} className="text-gray-500 hover:text-gray-700 text-xs">✕</button>
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
                          <summary className="cursor-pointer font-semibold text-gray-700 text-xs py-1">{ps.name}</summary>
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

          {!overlayVisible && !selected && sectionActive && (
            <button onClick={clearSectionBox}
              className="absolute top-16 left-4 bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded text-xs shadow">
              ✕ Clear section
            </button>
          )}

          {/* context menu */}
          {contextMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
              <div className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 text-sm w-48"
                style={{ left: contextMenu.x, top: contextMenu.y }}>
                {selected && (
                  <>
                    <button onClick={isolateSelected} className="w-full text-left px-3 py-2 hover:bg-gray-100">🔆 Isolate</button>
                    <button onClick={hideSelected} className="w-full text-left px-3 py-2 hover:bg-gray-100">🚫 Hide</button>
                    <button onClick={() => { applySectionBox(); setContextMenu(null) }} className="w-full text-left px-3 py-2 hover:bg-gray-100">✂️ Section box</button>
                    <div className="border-t my-1" />
                  </>
                )}
                <button onClick={deleteClipHere} className="w-full text-left px-3 py-2 hover:bg-gray-100">🗑 Delete cut here</button>
                <button onClick={showAll} className="w-full text-left px-3 py-2 hover:bg-gray-100">👁️ Show all</button>
              </div>
            </>
          )}

          {!overlayVisible && !selected && modelList.length > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
              {multi ? 'Click an element to select · double-click a model to enter it' : 'Click an element to select it'}
            </div>
          )}

          {!overlayVisible && modelList.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-center px-6">
              <p>No models in the scene.<br />Add models from the list on the left.</p>
            </div>
          )}

          {overlayVisible && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-center px-6">
              {errorMsg ? <p className="text-red-300">Error: {errorMsg}</p> : (
                <div>
                  <div className="animate-spin h-8 w-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-3" />
                  <p>Loading 3D...</p>
                </div>
              )}
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
                      <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: statusColor(t.status) }} />
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
                  {selected && <div className="text-blue-700 text-sm">🔗 {selected.elementName || selected.name}</div>}
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

      {/* NEW CONVERSATION MODAL */}
      {showNewConvModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">New conversation</h2>

            <div className="inline-flex bg-gray-200 rounded-lg p-1 mb-4">
              <button onClick={() => { setNcType('dm'); setNcMembers([]) }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${ncType === 'dm' ? 'bg-white text-blue-700 shadow' : 'text-gray-600'}`}>👤 Direct</button>
              <button onClick={() => { setNcType('group'); setNcMembers([]) }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${ncType === 'group' ? 'bg-white text-blue-700 shadow' : 'text-gray-600'}`}>👥 Group</button>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">{ncType === 'dm' ? 'Person *' : 'Members *'}</label>
                <div className="border border-gray-300 rounded-lg max-h-40 overflow-y-auto">
                  {projectMembersExceptMe.length === 0 ? (
                    <p className="text-xs text-gray-400 p-3">No other members in this project yet.</p>
                  ) : projectMembersExceptMe.map(m => {
                    const checked = ncMembers.includes(m.user_email)
                    return (
                      <label key={m.user_email}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm border-b last:border-b-0">
                        <input type={ncType === 'dm' ? 'radio' : 'checkbox'} name="conv-members" checked={checked}
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
                      ? String(activeFileId ?? (modelList[0]?.id ?? ''))
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
              <button onClick={closeNewConvModal} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>
              <button onClick={createConversation} className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}