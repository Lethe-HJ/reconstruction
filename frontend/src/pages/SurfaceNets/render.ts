import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export class ThreeRenderer {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private container: HTMLElement
  private mesh: THREE.Mesh | null = null
  private animationId: number | null = null
  private resizeHandler: () => void

  constructor (container: HTMLElement) {
    this.container = container
    const width = container.clientWidth
    const height = container.clientHeight
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1b26)
    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 10000)
    this.camera.position.set(100, 100, 100)
    this.camera.lookAt(0, 0, 0)
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(width, height)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(this.renderer.domElement)
    this.setupLights()
    const axesHelper = new THREE.AxesHelper(50)
    this.scene.add(axesHelper)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.enableZoom = true
    this.controls.enablePan = true
    this.controls.minDistance = 10
    this.controls.maxDistance = 1000
    this.controls.target.set(0, 0, 0)
    this.resizeHandler = () => {
      const newWidth = this.container.clientWidth
      const newHeight = this.container.clientHeight
      this.camera.aspect = newWidth / newHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(newWidth, newHeight)
    }
    window.addEventListener('resize', this.resizeHandler)
    this.animate()
  }

  private setupLights (): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    this.scene.add(ambientLight)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.3)
    directionalLight.position.set(100, 120, 80)
    directionalLight.castShadow = false
    this.scene.add(directionalLight)
    const pointLight = new THREE.PointLight(0xffffff, 0.9, 0, 2)
    pointLight.position.set(-80, 60, 120)
    this.scene.add(pointLight)
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  updateMesh (
    positionsData: ArrayBuffer,
    positionsLength: number,
    cellsData: ArrayBuffer,
    cellsLength: number,
    voxelShape: [number, number, number],
    color: string = '#7aa2f7'
  ): void {
    if (positionsLength <= 0 || cellsLength <= 0) {
      console.warn('警告: 无效的网格数据长度', { positionsLength, cellsLength })
      return
    }
    void voxelShape
    if (this.mesh) {
      this.scene.remove(this.mesh)
      if (this.mesh.geometry) this.mesh.geometry.dispose()
      if (this.mesh.material) {
        if (Array.isArray(this.mesh.material)) {
          this.mesh.material.forEach((mat) => mat.dispose())
        } else {
          this.mesh.material.dispose()
        }
      }
      this.mesh = null
    }
    const geometry = new THREE.BufferGeometry()
    const flatPositions = new Float32Array(positionsData)
    const flatIndices = new Uint32Array(cellsData)
    geometry.setAttribute('position', new THREE.BufferAttribute(flatPositions, 3))
    geometry.setIndex(new THREE.BufferAttribute(flatIndices, 1))
    geometry.computeVertexNormals()
    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(color),
      specular: new THREE.Color('#ffffff'),
      shininess: 60,
      side: THREE.FrontSide,
      flatShading: false
    })
    const mesh = new THREE.Mesh(geometry, material)
    geometry.computeBoundingBox()
    const center = new THREE.Vector3()
    if (geometry.boundingBox) {
      geometry.boundingBox.getCenter(center)
      mesh.position.sub(center)
      const size = new THREE.Vector3()
      geometry.boundingBox.getSize(size)
      const maxDim = Math.max(size.x, size.y, size.z)
      const distance = maxDim * 1.5
      this.camera.position.set(distance, distance, distance)
    }
    this.controls.target.set(0, 0, 0)
    this.controls.update()
    this.scene.add(mesh)
    this.mesh = mesh
  }

  dispose (): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    window.removeEventListener('resize', this.resizeHandler)
    if (this.controls) this.controls.dispose()
    if (this.mesh) {
      this.scene.remove(this.mesh)
      if (this.mesh.geometry) this.mesh.geometry.dispose()
      if (this.mesh.material) {
        if (Array.isArray(this.mesh.material)) {
          this.mesh.material.forEach((mat) => mat.dispose())
        } else {
          this.mesh.material.dispose()
        }
      }
      this.mesh = null
    }
    if (this.renderer) {
      this.container.removeChild(this.renderer.domElement)
      this.renderer.dispose()
    }
    while (this.scene.children.length > 0) {
      const object = this.scene.children[0]!
      this.scene.remove(object)
      if (object instanceof THREE.Mesh) {
        if (object.geometry) object.geometry.dispose()
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((mat) => mat.dispose())
          } else {
            object.material.dispose()
          }
        }
      }
    }
  }

  getDomElement (): HTMLCanvasElement {
    return this.renderer.domElement
  }
}
