const { createApp, ref, computed, watch, onMounted } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

createApp({
    setup() {
        const currentTab = ref('accounts');
        const syncStatus = ref('');
        const bulkBlacklistText = ref('');
        const showBulkLoadModal = ref(false);
        const bulkLoadText = ref('');
        
        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);
        const filters = ref({ minQuality: 2.5 });

        // Buscadores y ordenadores restaurados
        const accountSearch = ref('');
        const accountSort = ref({ field: null, desc: false });
        
        const poolSearch = ref('');
        const poolSort = ref({ field: null, desc: false });

        // ==========================================
        // 🔄 PERSISTENCIA LOCALSTORAGE
        // ==========================================
        const saveData = () => {
            localStorage.setItem('vpnerp_acc_v14', JSON.stringify(accounts.value));
            localStorage.setItem('vpnerp_blk_v14', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            let savedAcc = JSON.parse(localStorage.getItem('vpnerp_acc_v14'));
            let savedBlk = JSON.parse(localStorage.getItem('vpnerp_blk_v14'));

            if (savedAcc && savedAcc.length > 0) {
                accounts.value = savedAcc;
            }
            blacklist.value = savedBlk || [];
        };

        watch([accounts, blacklist], saveData, { deep: true });

        // ==========================================
        // 📥 CARGA MASIVA DE TEXTO (TU FORMATO)
        // ==========================================
        const processBulkLoad = () => {
            if (!bulkLoadText.value.trim()) return;
            
            const lineas = bulkLoadText.value.trim().split('\n');
            let nuevasCuentas = [];

            lineas.forEach(linea => {
                const partes = linea.trim().split(/\s+/);
                if (partes.length >= 2) {
                    nuevasCuentas.push({
                        uid: generateUid(),
                        name: partes[0] || "",
                        fecha: partes[1] || "",
                        nodeId: partes.length >= 3 ? partes[2] : "",
                        ip: partes.length >= 4 ? partes[3] : ""
                    });
                }
            });

            accounts.value = nuevasCuentas;
            showBulkLoadModal.value = false;
            bulkLoadText.value = '';
            showStatus(`¡Cargadas ${nuevasCuentas.length} cuentas!`);
        };

        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, fecha: '', nodeId: '', ip: '' });
        };
        const removeAccount = (uid) => { if(confirm("¿Eliminar cuenta?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };

        // ==========================================
        // 🔴 MOTOR DE COLISIÓN (REGLA /24 ESTRICTA)
        // ==========================================
        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            
            return accounts.value.some(acc => {
                if (acc.uid === currentAccount.uid) return false;

                // 1. Choque de Nodo Idéntico
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();
                if (accNode !== '' && curNode !== '' && accNode === curNode) return true;

                // 2. Choque de IP (Regla: Si los 3 primeros bloques son iguales, BLOQUEA)
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                
                if (curIp && accIp) {
                    const octCur = curIp.split('.');
                    const octAcc = accIp.split('.');
                    
                    if (octCur.length === 4 && octAcc.length === 4) {
                        // Ej: 86.172.94.228 choca con 86.172.94.10 -> Bloquea
                        if (octCur[0] === octAcc[0] && 
                            octCur[1] === octAcc[1] && 
                            octCur[2] === octAcc[2]) {
                            return true; 
                        }
                    }
                }
                return false;
            });
        };

        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        // ==========================================
        // 🔍 ORDENAMIENTO Y BÚSQUEDA (CUENTAS)
        // ==========================================
        const toggleAccountSort = (field) => {
            if (accountSort.value.field === field) {
                accountSort.value.desc = !accountSort.value.desc;
            } else {
                accountSort.value.field = field;
                accountSort.value.desc = false;
            }
        };

        const processedAccounts = computed(() => {
            let result = accounts.value;
            
            // Búsqueda
            if (accountSearch.value) {
                const s = accountSearch.value.toLowerCase().trim();
                result = result.filter(a => 
                    (a.name || '').toLowerCase().includes(s) || 
                    (a.fecha || '').toLowerCase().includes(s) ||
                    (a.nodeId || '').toLowerCase().includes(s) || 
                    (a.ip || '').toLowerCase().includes(s)
                );
            }

            // Ordenamiento por clic
            if (accountSort.value.field) {
                result = [...result].sort((a, b) => {
                    let valA = (a[accountSort.value.field] || '').toLowerCase();
                    let valB = (b[accountSort.value.field] || '').toLowerCase();
                    if (valA < valB) return accountSort.value.desc ? 1 : -1;
                    if (valA > valB) return accountSort.value.desc ? -1 : 1;
                    return 0;
                });
            }
            return result;
        });

        // ==========================================
        // 🔍 ORDENAMIENTO Y BÚSQUEDA (POOL)
        // ==========================================
        const togglePoolSort = (field) => {
            if (poolSort.value.field === field) {
                poolSort.value.desc = !poolSort.value.desc;
            } else {
                poolSort.value.field = field;
                poolSort.value.desc = false;
            }
        };

        const processedPool = computed(() => {
            let result = pool.value;

            // Búsqueda en Pool
            if (poolSearch.value) {
                const s = poolSearch.value.toLowerCase().trim();
                result = result.filter(a => 
                    (a.id || '').toLowerCase().includes(s) || 
                    (a.ip || '').toLowerCase().includes(s) ||
                    (a.city || '').toLowerCase().includes(s) || 
                    (a.asn_isp || '').toLowerCase().includes(s)
                );
            }

            // Ordenamiento por clic en Pool
            if (poolSort.value.field) {
                result = [...result].sort((a, b) => {
                    let valA = a[poolSort.value.field] || '';
                    let valB = b[poolSort.value.field] || '';
                    
                    // Si ordenas por calidad, convertir a número
                    if (poolSort.value.field === 'q_score') {
                        valA = parseFloat(valA) || 0;
                        valB = parseFloat(valB) || 0;
                    } else {
                        valA = valA.toString().toLowerCase();
                        valB = valB.toString().toLowerCase();
                    }

                    if (valA < valB) return poolSort.value.desc ? 1 : -1;
                    if (valA > valB) return poolSort.value.desc ? -1 : 1;
                    return 0;
                });
            }
            return result;
        });

        // ==========================================
        // 🚀 CASCADA MYSTERIUM (ANTI-FALLOS)
        // ==========================================
        const processNodeData = (data) => {
            const rawPool = [];
            const seenIds = new Set(); 
            const minQ = parseFloat(filters.value.minQuality) || 2.5;

            data.forEach(nodo => {
                if (!nodo.provider_id) return;
                
                let calidad = nodo.quality?.quality || 0;
                if (calidad < minQ) return;

                const idCorto = nodo.provider_id.substring(0, 14);
                if(seenIds.has(idCorto)) return; 
                
                const ip = nodo.endpoint ? nodo.endpoint.split(':')[0] : null;
                if (!ip) return;

                // Verificamos si choca con la Blacklist o con el Motor (Regla /24) ANTES de mostrarlo
                const dummyAccount = { uid: 'dummy', nodeId: idCorto, ip: ip };
                const isBlacklisted = blacklist.value.includes(idCorto) || blacklist.value.includes(ip);
                
                if (!isBlacklisted && !hasCollision(dummyAccount)) {
                    seenIds.add(idCorto);
                    rawPool.push({
                        id: idCorto,
                        ip: ip,
                        city: nodo.location?.city || 'Desconocida',
                        asn_isp: `${nodo.location?.asn || ''} - ${nodo.location?.isp || 'Desconocido'}`,
                        q_score: calidad.toFixed(2)
                    });
                }
            });
            pool.value = rawPool;
            showStatus(`Pool Actualizado: ${pool.value.length} nodos limpios`);
        };

        const fetchAPI = async () => {
            syncStatus.value = 'Conectando a Mysterium...';
            const targetUrl = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
            let data = null;

            // CASCADA DE PROXIES
            const attempts = [
                { name: 'Proxy 1 (AllOrigins)', url: `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, type: 'allorigins' },
                { name: 'Proxy 2 (CORS Proxy)', url: `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`, type: 'direct' },
                { name: 'Proxy 3 (CodeTabs)', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, type: 'direct' }
            ];

            for (let attempt of attempts) {
                syncStatus.value = `Intentando: ${attempt.name}...`;
                try {
                    const res = await fetch(attempt.url, { cache: 'no-store' });
                    if (res.ok) {
                        let parsed = null;
                        if (attempt.type === 'allorigins') {
                            const proxyData = await res.json();
                            parsed = JSON.parse(proxyData.contents);
                        } else {
                            const text = await res.text();
                            parsed = JSON.parse(text);
                        }

                        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].provider_id) {
                            data = parsed;
                            break; 
                        }
                    }
                } catch (e) {
                    console.warn(`Fallo en ${attempt.name}`);
                }
            }

            if (data && Array.isArray(data)) {
                processNodeData(data);
            } else {
                alert("🚫 Todos los proxies fallaron. La red está bloqueando la conexión.");
                syncStatus.value = 'Error de conexión.';
            }
            setTimeout(() => { syncStatus.value = ''; }, 3000);
        };

        // --- BLACKLIST ---
        const processBulkBlacklist = () => {
            if(!bulkBlacklistText.value.trim()) return;
            const rawItems = bulkBlacklistText.value.split(/[\n,\s]+/);
            rawItems.forEach(item => {
                const limpio = item.trim();
                if(limpio.length >= 10 && !blacklist.value.includes(limpio)) { 
                    const truncado = limpio.length > 15 ? limpio.substring(0, 14) : limpio;
                    blacklist.value.unshift(truncado);
                }
            });
            bulkBlacklistText.value = ''; 
        };
        const removeBlacklistNode = (index) => { blacklist.value.splice(index, 1); };

        const copyToClipboard = async (text, type = 'Dato') => {
            try { 
                await navigator.clipboard.writeText(text); 
                showStatus(`¡${type} Copiado!`); 
            } catch (err) {}
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ accounts: accounts.value, blacklist: blacklist.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_ERP_Respaldo.json`;
            a.click();
        };

        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 3000); };
        
        onMounted(() => { loadData(); });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            collisionCount, hasCollision, addAccount, removeAccount, processBulkBlacklist, 
            removeBlacklistNode, fetchAPI, copyToClipboard, exportDatabase,
            filters, showBulkLoadModal, bulkLoadText, processBulkLoad,
            // Variables de búsqueda y orden
            accountSearch, toggleAccountSort, processedAccounts,
            poolSearch, togglePoolSort, processedPool
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
