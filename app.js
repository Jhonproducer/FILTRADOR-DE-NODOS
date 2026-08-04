const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

// Filtro estricto: Solo dejamos pasar a los Gigantes de UK
const topUkISPs = ['bt', 'virgin', 'sky', 'talktalk', 'vodafone', 'ee', 'o2', 'plusnet', 'three'];

createApp({
    setup() {
        const currentTab = ref('accounts');
        const syncStatus = ref('');
        const bulkBlacklistText = ref('');
        
        const showPoolModal = ref(false);
        const selectedAccountUid = ref(null);

        const showAccountSelectModal = ref(false);
        const nodeToAssign = ref(null);
        
        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);

        // NUEVA VARIABLE GLOBAL: Para el Recomendador Anti-Sospechas
        const lastWorkedIsp = ref('');

        const filters = ref({ nodeId: '', city: '', isp: '', minQuality: '2.5' });
        const sortDesc = ref(true); 
        const toggleSortScore = () => { sortDesc.value = !sortDesc.value; };
        const clearFilters = () => { filters.value.nodeId = ''; filters.value.city = ''; filters.value.isp = ''; filters.value.minQuality = ''; };

        const filteredPool = computed(() => {
            let result = pool.value;
            result = result.filter(n => {
                const inBlacklist = blacklist.value.some(b => b.nodeId === n.id);
                const inUse = accounts.value.some(a => (a.nodeId || '').trim() === n.id);
                return !inBlacklist && !inUse;
            });
            if (filters.value.nodeId) {
                const s = filters.value.nodeId.toLowerCase().trim();
                result = result.filter(n => n.id.toLowerCase().includes(s));
            }
            if (filters.value.city) {
                const c = filters.value.city.toLowerCase().trim();
                result = result.filter(n => (n.city || '').toLowerCase().includes(c));
            }
            if (filters.value.isp) {
                const i = filters.value.isp.toLowerCase().trim();
                result = result.filter(n => (n.asn_isp || '').toLowerCase().includes(i));
            }
            // NUEVO FILTRO DE CALIDAD
            if (filters.value.minQuality) {
                const minQ = parseFloat(filters.value.minQuality);
                if (!isNaN(minQ)) {
                    result = result.filter(n => parseFloat(n.q_score) >= minQ);
                }
            }
            return result.sort((a, b) => sortDesc.value ? b.q_score - a.q_score : a.q_score - b.q_score);
        });

        const accountSearch = ref('');
        const accountSort = ref({ field: null, desc: false });

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
            if (accountSearch.value) {
                const s = accountSearch.value.toLowerCase().trim();
                result = result.filter(a => 
                    a.name.toLowerCase().includes(s) || 
                    (a.nodeId || '').toLowerCase().includes(s) || 
                    (a.ip || '').toLowerCase().includes(s) ||
                    (a.asn_isp || '').toLowerCase().includes(s)
                );
            }
            if (accountSort.value.field) {
                result = [...result].sort((a, b) => {
                    let valA = a[accountSort.value.field] || '';
                    let valB = b[accountSort.value.field] || '';
                    if (accountSort.value.field === 'q_score') {
                        valA = parseFloat(valA) || 0;
                        valB = parseFloat(valB) || 0;
                    }
                    if (valA < valB) return accountSort.value.desc ? 1 : -1;
                    if (valA > valB) return accountSort.value.desc ? -1 : 1;
                    return 0;
                });
            }
            return result;
        });

        const saveData = () => {
            localStorage.setItem('vpnerp_acc_master_final', JSON.stringify(accounts.value));
            localStorage.setItem('vpnerp_pool_master_final', JSON.stringify(pool.value));
            localStorage.setItem('vpnerp_blk_master_final', JSON.stringify(blacklist.value));
            localStorage.setItem('vpnerp_last_isp', lastWorkedIsp.value);
        };

        const loadData = () => {
            let savedAcc = JSON.parse(localStorage.getItem('vpnerp_acc_master_final'));
            let savedPool = JSON.parse(localStorage.getItem('vpnerp_pool_master_final'));
            let savedBlk = JSON.parse(localStorage.getItem('vpnerp_blk_master_final'));
            lastWorkedIsp.value = localStorage.getItem('vpnerp_last_isp') || '';

            if (!savedAcc || savedAcc.length === 0) {
                const oldKeys = ['v12', 'v11', 'master', 'v9', 'v8'];
                for (let v of oldKeys) {
                    let oldAcc = JSON.parse(localStorage.getItem(`vpnerp_acc_master_${v}`)) || JSON.parse(localStorage.getItem(`vpnerp_acc_${v}`));
                    if (oldAcc && oldAcc.length > 0) {
                        savedAcc = oldAcc;
                        savedPool = JSON.parse(localStorage.getItem(`vpnerp_pool_master_${v}`)) || JSON.parse(localStorage.getItem(`vpnerp_pool_${v}`));
                        savedBlk = JSON.parse(localStorage.getItem(`vpnerp_blk_master_${v}`)) || JSON.parse(localStorage.getItem(`vpnerp_blk_${v}`));
                        break;
                    }
                }
            }

            if (savedAcc && savedAcc.length > 0) {
                accounts.value = savedAcc.map(a => ({ 
                    ...a, 
                    uid: a.uid || generateUid(),
                    previousIp: a.previousIp || null
                }));
            } else {
                const initial = [];
                for(let i = 1; i <= 28; i++) {
                    const num = i < 10 ? '0'+i : i;
                    initial.push({ uid: generateUid(), name: `LON-${num}`, nodeId: '', ip: '', q_score: '', asn_isp: '', previousIp: null });
                }
                accounts.value = initial;
            }
            pool.value = savedPool || [];
            blacklist.value = savedBlk || [];
        };

        watch([accounts, pool, blacklist, lastWorkedIsp], saveData, { deep: true });

        // ==========================================
        // 🌟 RECOMENDADOR INTELIGENTE (ANTI-SOSPECHAS)
        // ==========================================
        const extractCoreIsp = (fullIspStr) => {
            if(!fullIspStr) return '';
            const lower = fullIspStr.toLowerCase();
            for(let top of topUkISPs) {
                if(lower.includes(top)) return top;
            }
            return fullIspStr.split(' ')[0]; // fallback
        };

        const markAsWorked = (fullIspStr) => {
            if(!fullIspStr) {
                showStatus('Esta cuenta no tiene proveedor.'); return;
            }
            lastWorkedIsp.value = extractCoreIsp(fullIspStr);
            showStatus('Marcado. Recomendaciones actualizadas.');
        };

        const isRecommended = (acc) => {
            if(!acc.nodeId || !acc.asn_isp) return false; // Solo recomendamos cuentas listas para trabajar
            if(!lastWorkedIsp.value) return true; // Si no he trabajado nada, todas son recomendadas
            
            const currentCore = extractCoreIsp(acc.asn_isp);
            // Es recomendado si NO ES IGUAL al último trabajado
            return currentCore !== lastWorkedIsp.value;
        };


        // ==========================================
        // ⚡ AUTO IP (Múltiples métodos silenciosos)
        // ==========================================
        const fetchCurrentIP = async (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(!acc) return;

            syncStatus.value = 'Detectando IP...';
            let newIp = null;

            try {
                const r1 = await fetch("https://api.ipify.org?format=json");
                if(r1.ok) { const d1 = await r1.json(); newIp = d1.ip; }
            } catch(e) {}

            if(!newIp) {
                try {
                    const r2 = await fetch("https://ipinfo.io/json", { headers: { 'Authorization': 'Bearer 8c97cc52a98a48' } });
                    if(r2.ok) { const d2 = await r2.json(); newIp = d2.ip; }
                } catch(e) {}
            }

            if(!newIp) {
                try {
                    const r3 = await fetch("https://api.myip.com");
                    if(r3.ok) { const d3 = await r3.json(); newIp = d3.ip; }
                } catch(e) {}
            }

            if(newIp) {
                if(acc.ip === newIp) { 
                    syncStatus.value = 'La IP no ha cambiado.'; 
                    setTimeout(() => { syncStatus.value = ''; }, 3000);
                    return; 
                }

                const collides = accounts.value.some(a => a.uid !== uid && a.ip === newIp);
                if(collides) {
                    const proceed = confirm(`⚠️ ALERTA DE COLISIÓN\n\nLa IP (${newIp}) YA ESTÁ en otra cuenta.\n¿Sobrescribir?`);
                    if(!proceed) { syncStatus.value = ''; return; }
                }

                acc.previousIp = acc.ip; 
                acc.ip = newIp;
                triggerCollisionCheck(acc);
                syncStatus.value = '¡IP Actualizada!';
            } else {
                alert("Error de red. No se pudo leer la IP.");
                syncStatus.value = '';
            }
            setTimeout(() => { syncStatus.value = ''; }, 3000);
        };

        const undoIp = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc && acc.previousIp !== null) {
                acc.ip = acc.previousIp; 
                acc.previousIp = null; 
                triggerCollisionCheck(acc); 
                syncStatus.value = 'IP Restaurada.';
                setTimeout(() => { syncStatus.value = ''; }, 3000);
            }
        };

        const openPoolModal = (uid) => { selectedAccountUid.value = uid; clearFilters(); showPoolModal.value = true; };
        const closePoolModal = () => { showPoolModal.value = false; selectedAccountUid.value = null; };
        const openAccountSelectModal = (node) => { nodeToAssign.value = node; showAccountSelectModal.value = true; };
        const closeAccountSelectModal = () => { showAccountSelectModal.value = false; nodeToAssign.value = null; };
        
        const triggerCollisionCheck = (currentAccount) => {
            if(hasCollision(currentAccount)) {
                alert(`¡ALERTA CRÍTICA!\n\nEl Nodo o IP ingresado YA EXISTE en otra cuenta activa.`);
            }
        };

        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            return accounts.value.some(acc => {
                if (acc.uid === currentAccount.uid) return false;
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();
                return (accIp !== '' && curIp !== '' && accIp === curIp) || 
                       (accNode !== '' && curNode !== '' && accNode === curNode);
            });
        };

        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        const assignNodeToAccount = (nodeId) => {
            if (selectedAccountUid.value) {
                const acc = accounts.value.find(a => a.uid === selectedAccountUid.value);
                if (acc) {
                    const nodeData = pool.value.find(n => n.id === nodeId);
                    acc.nodeId = nodeId; acc.ip = ''; acc.previousIp = null; 
                    if(nodeData) { acc.q_score = nodeData.q_score; acc.asn_isp = nodeData.asn_isp; }
                    closePoolModal(); triggerCollisionCheck(acc);
                }
            }
        };

        const confirmAssignFromPool = (accountUid) => {
            const acc = accounts.value.find(a => a.uid === accountUid);
            if (acc && nodeToAssign.value) {
                acc.nodeId = nodeToAssign.value.id;
                acc.ip = ''; acc.previousIp = null;
                acc.q_score = nodeToAssign.value.q_score;
                acc.asn_isp = nodeToAssign.value.asn_isp;
                closeAccountSelectModal(); triggerCollisionCheck(acc); showStatus(`Asignado a ${acc.name}`);
            }
        };

        const burnDirectlyFromPool = (node) => {
            if(node && node.id) {
                if(!blacklist.value.some(b => b.nodeId === node.id)) {
                    blacklist.value.unshift({ nodeId: node.id, ip: 'Quemado desde Pool' });
                }
            }
        };

        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '', q_score: '', asn_isp: '', previousIp: null });
        };
        const removeAccount = (uid) => { if(confirm("¿Eliminar cuenta?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };
        const releaseNode = (uid) => { const acc = accounts.value.find(a => a.uid === uid); if(acc) { acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.previousIp = null; } };
        
        const burnNode = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc) {
                const nodeStr = (acc.nodeId || '').trim();
                if(nodeStr) {
                    const truncado = nodeStr.substring(0, 14); 
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: acc.ip || 'Desconocida' });
                    }
                }
                acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.previousIp = null;
            }
        };

        const processBulkBlacklist = () => {
            if(!bulkBlacklistText.value.trim()) return;
            const rawItems = bulkBlacklistText.value.split(/[\n,\s]+/);
            rawItems.forEach(item => {
                const limpio = item.trim();
                if(limpio.length >= 10) { 
                    const truncado = limpio.substring(0, 14); 
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: 'Carga Masiva' });
                    }
                }
            });
            bulkBlacklistText.value = ''; 
        };
        const removeBlacklistNode = (index) => { blacklist.value.splice(index, 1); };

        const processNodeData = (data) => {
            const rawPool = [];
            const seenIds = new Set(); 
            data.forEach(nodo => {
                if (nodo.service_type !== "wireguard" || !nodo.provider_id) return;
                
                // NUEVO: FILTRO ESTRICTO DE PROVEEDORES TOP DE UK
                const ispStr = (nodo.location?.isp || '').toLowerCase();
                const isTopIsp = topUkISPs.some(top => ispStr.includes(top));
                
                // Si no es un gigante de UK, se ignora y no entra a la Pool
                if(!isTopIsp) return;

                const idCorto = nodo.provider_id.substring(0, 14);
                if(seenIds.has(idCorto)) return;
                
                const isBlacklisted = blacklist.value.some(b => b.nodeId === idCorto);
                const isUsed = accounts.value.some(a => (a.nodeId || '').trim() === idCorto);
                
                if (!isBlacklisted && !isUsed) {
                    seenIds.add(idCorto);
                    rawPool.push({
                        id: idCorto,
                        city: nodo.location?.city || 'N/A',
                        asn_isp: `${nodo.location?.asn || ''} - ${nodo.location?.isp || 'N/A'}`,
                        q_score: (nodo.quality?.quality || 0).toFixed(2)
                    });
                }
            });
            pool.value = rawPool.sort((a, b) => b.q_score - a.q_score);
            showStatus(`Pool Top UK: ${pool.value.length} nodos`);
        };

        // ==========================================
        // 🚀 API DE MYSTERIUM (PURA, DIRECTA, SIN PROXIES)
        // ==========================================
        const fetchAPI = async () => {
            syncStatus.value = 'Conectando a Mysterium...';
            try {
                // El llamado original y puro que siempre funcionó
                const url = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
                const response = await fetch(url, { headers: { 'accept': 'application/json' } });
                
                if(!response.ok) throw new Error("Error de red.");
                
                const data = await response.json();
                processNodeData(data);
                
            } catch (err) {
                console.error(err);
                alert("Error conectando con Mysterium. Si persiste, usa el botón de Importar JSON.");
                syncStatus.value = '';
            }
        };

        const importPoolJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    processNodeData(data); 
                    event.target.value = null; 
                } catch (err) { alert("Error JSON."); event.target.value = null; }
            };
            reader.readAsText(file);
        };

        // NUEVO: RESTAURAR BASE DE DATOS COMPLETA
        const restoreDatabase = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if(data.accounts && data.pool && data.blacklist) {
                        accounts.value = data.accounts;
                        pool.value = data.pool;
                        blacklist.value = data.blacklist;
                        showStatus('¡Base Restaurada al 100%!');
                    } else {
                        alert("El archivo no parece ser un respaldo válido de este sistema.");
                    }
                } catch (err) { alert("Error al leer el archivo de Respaldo."); }
                event.target.value = null; 
            };
            reader.readAsText(file);
        };

        const copyToClipboard = async (text, type = 'Dato') => {
            try { 
                await navigator.clipboard.writeText(text); 
                showStatus(`¡${type} Copiado!`); 
                setTimeout(() => { syncStatus.value = ''; }, 3000);
            } catch (err) { console.error(err); }
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ accounts: accounts.value, pool: pool.value, blacklist: blacklist.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_ERP_Respaldo_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
        };

        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 3000); };
        
        onMounted(() => { loadData(); });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            showPoolModal, selectedAccountUid, showAccountSelectModal, nodeToAssign,
            collisionCount, accountSearch, accountSort, processedAccounts, toggleAccountSort, 
            filters, filteredPool, toggleSortScore, clearFilters, hasCollision, triggerCollisionCheck, 
            addAccount, removeAccount, releaseNode, burnNode, processBulkBlacklist, removeBlacklistNode, 
            importPoolJSON, restoreDatabase, fetchAPI, copyToClipboard, exportDatabase, 
            openPoolModal, closePoolModal, assignNodeToAccount,
            openAccountSelectModal, closeAccountSelectModal, confirmAssignFromPool, burnDirectlyFromPool,
            fetchCurrentIP, undoIp, markAsWorked, isRecommended, lastWorkedIsp
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
