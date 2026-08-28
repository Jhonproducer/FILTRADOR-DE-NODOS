const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

createApp({
    setup() {
        const currentTab = ref('dashboard');
        const syncStatus = ref('');
        const ipinfoToken = '8c97cc52a98a48'; 
        
        const accounts = ref([]);
        const accountSearch = ref('');
        const accountSort = ref({ field: null, desc: false });
        
        const pool = ref([]);
        const poolFilters = ref({ nodeId: '', ip: '', isp: '', minQuality: '2.5' });
        const poolSort = ref({ field: null, desc: false });

        const blacklist = ref([]);
        const bulkBlacklistText = ref('');
        const showBulkLoadModal = ref(false);
        const bulkLoadText = ref('');

        let chartInstance = null;

        const saveData = () => {
            localStorage.setItem('vpn_nexus_acc', JSON.stringify(accounts.value));
            localStorage.setItem('vpn_nexus_blk', JSON.stringify(blacklist.value));
            updateCharts();
        };

        const loadData = () => {
            let savedAcc = JSON.parse(localStorage.getItem('vpn_nexus_acc'));
            let savedBlk = JSON.parse(localStorage.getItem('vpn_nexus_blk'));
            if (savedAcc && savedAcc.length > 0) accounts.value = savedAcc;
            blacklist.value = savedBlk || [];
        };

        watch([accounts, blacklist], saveData, { deep: true });

        const processBulkLoad = () => {
            if (!bulkLoadText.value.trim()) return;
            const lineas = bulkLoadText.value.trim().split('\n');
            let nuevasCuentas = [];
            lineas.forEach(linea => {
                const partes = linea.trim().split(/\s+/);
                if (partes.length >= 2) {
                    nuevasCuentas.push({
                        uid: generateUid(),
                        name: partes[0],
                        fecha: partes[1],
                        nodeId: partes.length >= 3 ? partes[2] : "",
                        ip: partes.length >= 4 ? partes[3] : "",
                        isp: 'Desconocido'
                    });
                }
            });
            accounts.value = nuevasCuentas;
            showBulkLoadModal.value = false;
            bulkLoadText.value = '';
            showStatus(`¡Cargadas ${nuevasCuentas.length} cuentas! Iniciando escáner...`);
            reinitIcons();
            forceEnrichmentSweep();
        };

        const fetchSingleISP = async (acc) => {
            if (!acc.ip || acc.ip === '0.0.0.0' || !acc.ip.includes('.')) return;
            try {
                const res = await fetch(`https://ipinfo.io/${acc.ip}/json?token=${ipinfoToken}`);
                if (res.ok) {
                    const data = await res.json();
                    let org = data.org || 'Desconocido';
                    acc.isp = org.replace(/^AS\d+\s/, '').trim();
                }
            } catch (error) {}
        };

        const forceEnrichmentSweep = async () => {
            syncStatus.value = 'Escaneando proveedores ISP...';
            for (let acc of accounts.value) {
                if (acc.ip && acc.ip !== 'Pendiente' && (!acc.isp || acc.isp === 'Desconocido')) {
                    await fetchSingleISP(acc);
                    await new Promise(r => setTimeout(r, 200));
                }
            }
            syncStatus.value = '¡Escaneo Completado!';
            setTimeout(() => { syncStatus.value = ''; }, 3000);
            updateCharts();
        };

        // AUTO DETECTAR IP DESDE EL BOTÓN DEL RAYO
        const autoDetectIP = async (acc) => {
            syncStatus.value = `Detectando red para ${acc.name}...`;
            try {
                const res = await fetch("https://api.ipify.org?format=json");
                const data = await res.json();
                acc.ip = data.ip;
                await fetchSingleISP(acc);
                
                if (hasCollision(acc)) {
                    alert(`🚨 ¡ALERTA DE COLISIÓN! \nLa IP ${acc.ip} choca con otra cuenta (los primeros 3 bloques son idénticos). Quema este nodo inmediatamente.`);
                } else {
                    showStatus('IP Limpia. Conexión segura.');
                }
            } catch(e) {
                alert("Error detectando IP. Verifica tu conexión.");
            }
            syncStatus.value = "";
            updateCharts();
        };

        // CHEQUEO MANUAL AL ESCRIBIR LA IP
        const manualIPCheck = async (acc) => {
            if (acc.ip && acc.ip.includes('.')) {
                if (hasCollision(acc)) {
                    alert(`🚨 ¡ALERTA DE COLISIÓN! \nLa IP ${acc.ip} choca con los primeros 3 bloques de otra cuenta activa. Deséchala.`);
                }
                await fetchSingleISP(acc);
                updateCharts();
            }
        };

        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, fecha: '', nodeId: '', ip: '', isp: 'Desconocido' });
            reinitIcons();
        };
        const removeAccount = (uid) => { if(confirm("¿Eliminar cuenta?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };

        const hasCollision = (currentAccount) => {
            if ((!currentAccount.ip || currentAccount.ip === 'Pendiente') && !currentAccount.nodeId) return false;
            return accounts.value.some(acc => {
                if (acc.uid === currentAccount.uid) return false;
                
                // Chequeo Nodo ID
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();
                if (accNode !== '' && curNode !== '' && accNode === curNode) return true;

                // Chequeo Subred IP (/24)
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                if (curIp && accIp && curIp !== 'Pendiente' && accIp !== 'Pendiente') {
                    const octCur = curIp.split('.');
                    const octAcc = accIp.split('.');
                    if (octCur.length === 4 && octAcc.length === 4) {
                        if (octCur[0] === octAcc[0] && octCur[1] === octAcc[1] && octCur[2] === octAcc[2]) return true; 
                    }
                }
                return false;
            });
        };
        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        const toggleAccountSort = (field) => {
            if (accountSort.value.field === field) accountSort.value.desc = !accountSort.value.desc;
            else { accountSort.value.field = field; accountSort.value.desc = false; }
            reinitIcons();
        };

        const processedAccounts = computed(() => {
            let result = accounts.value;
            if (accountSearch.value) {
                const s = accountSearch.value.toLowerCase().trim();
                result = result.filter(a => (a.name || '').toLowerCase().includes(s) || (a.nodeId || '').toLowerCase().includes(s) || (a.ip || '').toLowerCase().includes(s) || (a.isp || '').toLowerCase().includes(s));
            }
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

        const processNodeData = (data) => {
            const rawPool = [];
            const seenIds = new Set(); 
            data.forEach(nodo => {
                if (!nodo.provider_id) return;
                const idCorto = nodo.provider_id.substring(0, 14);
                if(seenIds.has(idCorto)) return; 
                
                const dummyAccount = { uid: 'dummy', nodeId: idCorto, ip: '' }; // IP ignorada aquí
                const isBlacklisted = blacklist.value.includes(idCorto);
                
                if (!isBlacklisted && !hasCollision(dummyAccount)) {
                    seenIds.add(idCorto);
                    rawPool.push({
                        id: idCorto,
                        ip: 'Pendiente', // La IP ya no viene en el JSON de Mysterium
                        city: nodo.location?.city || 'Desconocida',
                        asn_isp: `${nodo.location?.asn || ''} ${nodo.location?.isp || ''}`.trim(),
                        q_score: (nodo.quality?.quality || 0).toFixed(2)
                    });
                }
            });
            pool.value = rawPool;
            showStatus(`Radar completado: ${pool.value.length} nodos limpios obtenidos.`);
        };

        const fetchMysteriumAPI = async () => {
            syncStatus.value = 'Extracción Agresiva en progreso...';
            const rawUrl = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
            const encodedUrl = encodeURIComponent(rawUrl);

            const proxies = [
                `https://api.allorigins.win/raw?url=${encodedUrl}`,
                `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
                `https://corsproxy.io/?${encodedUrl}`,
                rawUrl // Directo por si acaso
            ];

            try {
                const requests = proxies.map(url => 
                    fetch(url, { cache: 'no-store' }).then(res => {
                        if (!res.ok) throw new Error('Fallo proxy');
                        return res.json();
                    })
                );
                const data = await Promise.any(requests);
                if (Array.isArray(data) && data.length > 0 && data[0].provider_id) {
                    processNodeData(data);
                } else {
                    throw new Error("Datos vacíos");
                }
            } catch (e) {
                alert("🚫 ERROR: Usa el botón verde 'Subir JSON Manual' cargando el archivo descargado de Mysterium.");
                syncStatus.value = 'Extracción bloqueada.';
            }
            setTimeout(() => { syncStatus.value = ''; }, 4000);
        };

        const importPoolJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (Array.isArray(data)) {
                        processNodeData(data);
                        showStatus('JSON Manual cargado exitosamente.');
                    } else if (data.contents) {
                        processNodeData(JSON.parse(data.contents));
                        showStatus('JSON Manual cargado exitosamente.');
                    } else {
                        throw new Error("Formato inválido");
                    }
                } catch (err) {
                    alert("🚫 Error al leer el archivo JSON.");
                }
                event.target.value = null; 
            };
            reader.readAsText(file);
        };

        const burnDirectlyFromPool = (nodeId) => {
            if (!blacklist.value.includes(nodeId)) {
                blacklist.value.unshift(nodeId);
                pool.value = pool.value.filter(n => n.id !== nodeId);
                showStatus(`Nodo ${nodeId} bloqueado directamente.`);
            }
        };

        const togglePoolSort = (field) => {
            if (poolSort.value.field === field) poolSort.value.desc = !poolSort.value.desc;
            else { poolSort.value.field = field; poolSort.value.desc = false; }
            reinitIcons();
        };

        const filteredPool = computed(() => {
            let result = pool.value;
            if (poolFilters.value.nodeId) {
                const s = poolFilters.value.nodeId.toLowerCase().trim();
                result = result.filter(n => n.id.toLowerCase().includes(s));
            }
            if (poolFilters.value.isp) {
                const s = poolFilters.value.isp.toLowerCase().trim();
                result = result.filter(n => (n.city || '').toLowerCase().includes(s) || (n.asn_isp || '').toLowerCase().includes(s));
            }
            if (poolFilters.value.minQuality) {
                const minQ = parseFloat(poolFilters.value.minQuality);
                if (!isNaN(minQ)) result = result.filter(n => parseFloat(n.q_score) >= minQ);
            }

            if (poolSort.value.field) {
                result = [...result].sort((a, b) => {
                    let valA = a[poolSort.value.field] || '';
                    let valB = b[poolSort.value.field] || '';
                    if (poolSort.value.field === 'q_score') return poolSort.value.desc ? parseFloat(valA) - parseFloat(valB) : parseFloat(valB) - parseFloat(valA);
                    valA = valA.toLowerCase(); valB = valB.toLowerCase();
                    if (valA < valB) return poolSort.value.desc ? 1 : -1;
                    if (valA > valB) return poolSort.value.desc ? -1 : 1;
                    return 0;
                });
            } else {
                result = [...result].sort((a, b) => parseFloat(b.q_score) - parseFloat(a.q_score));
            }
            return result;
        });

        const ispStats = computed(() => {
            const counts = {};
            const accountsWithIp = accounts.value.filter(a => a.ip && a.ip !== 'Pendiente').length || 1; 
            accounts.value.forEach(acc => {
                if (acc.isp && acc.isp !== 'Desconocido') {
                    let shortIsp = acc.isp.split(',')[0].substring(0, 18);
                    counts[shortIsp] = (counts[shortIsp] || 0) + 1;
                }
            });
            return Object.entries(counts)
                .map(([name, count]) => ({ name, count, percentage: Math.round((count / accountsWithIp) * 100) }))
                .sort((a, b) => b.count - a.count); 
        });

        const updateCharts = () => {
            nextTick(() => {
                const ctx = document.getElementById('ispChart');
                if (!ctx) return;
                const labels = ispStats.value.map(s => s.name);
                const data = ispStats.value.map(s => s.count);
                if (chartInstance) chartInstance.destroy();
                chartInstance = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: data,
                            backgroundColor: ['rgba(79, 70, 229, 0.9)', 'rgba(16, 185, 129, 0.9)', 'rgba(244, 63, 94, 0.9)', 'rgba(245, 158, 11, 0.9)', 'rgba(14, 165, 233, 0.9)', 'rgba(168, 85, 247, 0.9)'],
                            borderColor: '#1e293b',
                            borderWidth: 3
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '65%' }
                });
            });
        };

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
            showStatus('Nodos enviados a Cuarentena.');
        };
        const removeBlacklistNode = (index) => { blacklist.value.splice(index, 1); };
        const copyToClipboard = async (text, type = 'Dato') => { try { await navigator.clipboard.writeText(text); showStatus(`¡${type} Copiado!`); } catch (err) {} };
        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 3000); };
        const reinitIcons = () => { nextTick(() => { if(window.lucide) lucide.createIcons(); }); };
        
        onMounted(() => { 
            loadData(); 
            reinitIcons(); 
            updateCharts();
        });

        watch(currentTab, () => {
            reinitIcons();
            if (currentTab.value === 'dashboard') updateCharts();
        });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            collisionCount, hasCollision, addAccount, removeAccount, processBulkBlacklist, removeBlacklistNode,
            fetchMysteriumAPI, importPoolJSON, copyToClipboard, burnDirectlyFromPool,
            filteredPool, poolFilters, poolSort, togglePoolSort,
            processedAccounts, accountSearch, accountSort, toggleAccountSort,
            showBulkLoadModal, bulkLoadText, processBulkLoad, fetchSingleISP, forceEnrichmentSweep,
            ispStats, autoDetectIP, manualIPCheck
        };
    }
}).mount('#app');
