const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

createApp({
    setup() {
        const currentTab = ref('accounts');
        const syncStatus = ref('');
        
        // --- VARIABLES DE CUENTAS ---
        const accounts = ref([]);
        const accountSearch = ref('');
        const accountSort = ref({ field: null, desc: false });
        
        // --- VARIABLES DE POOL ---
        const pool = ref([]);
        const poolFilters = ref({ nodeId: '', city: '', isp: '', minQuality: '2.5' });
        const poolSort = ref({ field: null, desc: false });

        // --- VARIABLES DE CARGA Y BLACKLIST ---
        const blacklist = ref([]);
        const bulkBlacklistText = ref('');
        const showBulkLoadModal = ref(false);
        const bulkLoadText = ref('');

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
            if (savedAcc && savedAcc.length > 0) accounts.value = savedAcc;
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
                        name: partes[0], // LON-XX
                        fecha: partes[1], // Fecha
                        nodeId: partes.length >= 3 ? partes[2] : "",
                        ip: partes.length >= 4 ? partes[3] : ""
                    });
                }
            });

            accounts.value = nuevasCuentas;
            showBulkLoadModal.value = false;
            bulkLoadText.value = '';
            showStatus(`¡Cargadas ${nuevasCuentas.length} cuentas!`);
            reinitIcons();
        };

        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, fecha: '', nodeId: '', ip: '' });
            reinitIcons();
        };
        const removeAccount = (uid) => { if(confirm("¿Eliminar cuenta?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };

        // ==========================================
        // 🔴 MOTOR DE COLISIÓN (REGLA DE LOS 3 BLOQUES)
        // ==========================================
        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            
            return accounts.value.some(acc => {
                if (acc.uid === currentAccount.uid) return false;

                // 1. Choque si el Nodo ID es el mismo
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();
                if (accNode !== '' && curNode !== '' && accNode === curNode) return true;

                // 2. Choque de IP (Los 3 primeros bloques son idénticos)
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                
                if (curIp && accIp) {
                    const octCur = curIp.split('.');
                    const octAcc = accIp.split('.');
                    if (octCur.length === 4 && octAcc.length === 4) {
                        if (octCur[0] === octAcc[0] && octCur[1] === octAcc[1] && octCur[2] === octAcc[2]) {
                            return true; 
                        }
                    }
                }
                return false;
            });
        };

        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        // ==========================================
        // 🔍 ORDEN Y FILTRADO: CUENTAS
        // ==========================================
        const toggleAccountSort = (field) => {
            if (accountSort.value.field === field) accountSort.value.desc = !accountSort.value.desc;
            else { accountSort.value.field = field; accountSort.value.desc = false; }
            reinitIcons();
        };

        const processedAccounts = computed(() => {
            let result = accounts.value;
            // 1. Buscador global
            if (accountSearch.value) {
                const s = accountSearch.value.toLowerCase().trim();
                result = result.filter(a => 
                    (a.name || '').toLowerCase().includes(s) || 
                    (a.nodeId || '').toLowerCase().includes(s) || 
                    (a.ip || '').toLowerCase().includes(s)
                );
            }
            // 2. Orden al hacer clic en columnas
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
        // 🚀 CASCADA MYSTERIUM CON 5 PROXIES
        // ==========================================
        const processNodeData = (data) => {
            const rawPool = [];
            const seenIds = new Set(); 

            data.forEach(nodo => {
                if (!nodo.provider_id) return;
                
                const idCorto = nodo.provider_id.substring(0, 14);
                if(seenIds.has(idCorto)) return; 
                
                const ip = nodo.endpoint ? nodo.endpoint.split(':')[0] : null;
                if (!ip) return;

                // Verificamos si choca antes de agregarlo al Pool visible
                const dummyAccount = { uid: 'dummy', nodeId: idCorto, ip: ip };
                const isBlacklisted = blacklist.value.includes(idCorto) || blacklist.value.includes(ip);
                
                if (!isBlacklisted && !hasCollision(dummyAccount)) {
                    seenIds.add(idCorto);
                    rawPool.push({
                        id: idCorto,
                        ip: ip,
                        city: nodo.location?.city || 'Desconocida',
                        asn_isp: `${nodo.location?.asn || ''} - ${nodo.location?.isp || 'Desconocido'}`,
                        q_score: (nodo.quality?.quality || 0).toFixed(2)
                    });
                }
            });
            pool.value = rawPool;
            showStatus(`Pool Actualizado: ${pool.value.length} nodos limpios`);
        };

        const fetchAPI = async () => {
            syncStatus.value = 'Conectando (5 Proxies)...';
            const targetUrl = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
            let data = null;

            // 5 PROXIES para asegurar que siempre haya conexión
            const attempts = [
                { name: 'Proxy 1 (AllOrigins)', url: `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, type: 'allorigins' },
                { name: 'Proxy 2 (CorsProxy.io)', url: `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`, type: 'direct' },
                { name: 'Proxy 3 (CodeTabs)', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, type: 'direct' },
                { name: 'Proxy 4 (ThingProxy)', url: `https://thingproxy.freeboard.io/fetch/${targetUrl}`, type: 'direct' },
                { name: 'Proxy 5 (Sin Proxy)', url: targetUrl, type: 'direct' }
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
                            parsed = await res.json();
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
                alert("🚫 Todos los servidores fallaron. Intenta más tarde.");
                syncStatus.value = 'Error de conexión.';
            }
            setTimeout(() => { syncStatus.value = ''; }, 3000);
        };

        // ==========================================
        // 🔍 ORDEN Y FILTRADO: POOL
        // ==========================================
        const togglePoolSort = (field) => {
            if (poolSort.value.field === field) poolSort.value.desc = !poolSort.value.desc;
            else { poolSort.value.field = field; poolSort.value.desc = false; }
            reinitIcons();
        };

        const clearPoolFilters = () => {
            poolFilters.value = { nodeId: '', city: '', isp: '', minQuality: '2.5' };
        };

        const filteredPool = computed(() => {
            let result = pool.value;

            // Filtros de barra de búsqueda
            if (poolFilters.value.nodeId) {
                const s = poolFilters.value.nodeId.toLowerCase().trim();
                result = result.filter(n => n.id.toLowerCase().includes(s));
            }
            if (poolFilters.value.city) {
                const c = poolFilters.value.city.toLowerCase().trim();
                result = result.filter(n => n.city.toLowerCase().includes(c));
            }
            if (poolFilters.value.isp) {
                const i = poolFilters.value.isp.toLowerCase().trim();
                result = result.filter(n => n.asn_isp.toLowerCase().includes(i));
            }
            if (poolFilters.value.minQuality) {
                const minQ = parseFloat(poolFilters.value.minQuality);
                if (!isNaN(minQ)) result = result.filter(n => parseFloat(n.q_score) >= minQ);
            }

            // Ordenamiento por clic en la columna
            if (poolSort.value.field) {
                result = [...result].sort((a, b) => {
                    let valA = a[poolSort.value.field] || '';
                    let valB = b[poolSort.value.field] || '';
                    if (poolSort.value.field === 'q_score') {
                        valA = parseFloat(valA);
                        valB = parseFloat(valB);
                    } else {
                        valA = valA.toLowerCase();
                        valB = valB.toLowerCase();
                    }
                    if (valA < valB) return poolSort.value.desc ? 1 : -1;
                    if (valA > valB) return poolSort.value.desc ? -1 : 1;
                    return 0;
                });
            } else {
                // Por defecto, mostrar mayor calidad primero
                result = [...result].sort((a, b) => parseFloat(b.q_score) - parseFloat(a.q_score));
            }
            return result;
        });

        // ==========================================
        // 🚫 BLACKLIST Y UTILIDADES
        // ==========================================
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

        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 3000); };
        
        // Recargar los iconos cuando Vue actualiza la tabla
        const reinitIcons = () => { nextTick(() => { if(window.lucide) lucide.createIcons(); }); };
        
        onMounted(() => { 
            loadData(); 
            reinitIcons(); 
        });

        // Asegurar que si cambiamos de pestaña se carguen los íconos
        watch(currentTab, reinitIcons);

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            collisionCount, hasCollision, addAccount, removeAccount, processBulkBlacklist, 
            removeBlacklistNode, fetchAPI, copyToClipboard, 
            filteredPool, poolFilters, poolSort, togglePoolSort, clearPoolFilters,
            processedAccounts, accountSearch, accountSort, toggleAccountSort,
            showBulkLoadModal, bulkLoadText, processBulkLoad
        };
    }
}).mount('#app');
