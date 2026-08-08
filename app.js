const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

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

        // ==========================================
        // 🎯 MOTOR DE TANDAS Y SEMÁFORO TÁCTICO
        // ==========================================
        const BATCH_SIZE = 7;
        const currentTandaIndex = ref(0);
        const lastWorkedIsp = ref('');

        const getIspName = (fullString) => {
            if(!fullString) return '';
            return fullString.split('-').pop().trim().toLowerCase();
        };

        const getIspNameUI = (fullString) => {
            if(!fullString) return '';
            return fullString.split('-').pop().trim();
        };

        const totalTandas = computed(() => Math.ceil(accounts.value.length / BATCH_SIZE) || 1);

        watch(totalTandas, (newTotal) => {
            if (currentTandaIndex.value >= newTotal) currentTandaIndex.value = Math.max(0, newTotal - 1);
        });

        const nextTanda = () => { if (currentTandaIndex.value < totalTandas.value - 1) currentTandaIndex.value++; };
        const prevTanda = () => { if (currentTandaIndex.value > 0) currentTandaIndex.value--; };

        const currentTandaAccounts = computed(() => {
            const start = currentTandaIndex.value * BATCH_SIZE;
            return accounts.value.slice(start, start + BATCH_SIZE);
        });

        const currentTandaWorked = computed(() => currentTandaAccounts.value.filter(a => a.worked).length);

        const tandaProgress = computed(() => {
            const total = currentTandaAccounts.value.length;
            if (total === 0) return 0;
            return Math.round((currentTandaWorked.value / total) * 100);
        });

        const isIspSafe = (isp) => {
            if(!isp) return true;
            if(!lastWorkedIsp.value) return true;
            return getIspName(isp) !== lastWorkedIsp.value;
        };

        const markAsWorked = (acc) => {
            acc.worked = true;
            if (acc.asn_isp) lastWorkedIsp.value = getIspName(acc.asn_isp);
            showStatus(`ISP Marcado: ${lastWorkedIsp.value.toUpperCase()}`);
        };

        const unmarkWorked = (acc) => { acc.worked = false; };

        const resetAllWorked = () => {
            if(confirm("¿Reiniciar el estado de TODAS las cuentas?")) {
                accounts.value.forEach(a => a.worked = false);
                lastWorkedIsp.value = '';
                showStatus('Ciclo Reiniciado.');
            }
        };

        // ==========================================
        // 💎 FILTRO ELITE (Top 5 UK) CON BOTÓN
        // ==========================================
        const TOP_ISPS = ['bt', 'sky', 'virgin', 'talktalk', 'vodafone'];
        const isTopISP = (ispString) => {
            if(!ispString) return false;
            const low = ispString.toLowerCase();
            return TOP_ISPS.some(t => low.includes(t));
        };

        const filters = ref({ nodeId: '', city: '', isp: '', minQuality: '', onlyTopISP: false });
        const sortDesc = ref(true); 
        const toggleSortScore = () => { sortDesc.value = !sortDesc.value; };
        
        const clearFilters = () => { 
            filters.value.nodeId = ''; filters.value.city = ''; 
            filters.value.isp = ''; filters.value.minQuality = ''; 
            filters.value.onlyTopISP = false;
        };

        const filteredPool = computed(() => {
            let result = pool.value;
            result = result.filter(n => {
                const inBlacklist = blacklist.value.some(b => b.nodeId === n.id);
                const inUse = accounts.value.some(a => (a.nodeId || '').trim() === n.id);
                return !inBlacklist && !inUse;
            });
            
            // EL BOTÓN MÁGICO FUNCIONANDO
            if (filters.value.onlyTopISP) result = result.filter(n => isTopISP(n.asn_isp));
            
            if (filters.value.nodeId) result = result.filter(n => n.id.toLowerCase().includes(filters.value.nodeId.toLowerCase().trim()));
            if (filters.value.city) result = result.filter(n => (n.city || '').toLowerCase().includes(filters.value.city.toLowerCase().trim()));
            if (filters.value.isp) result = result.filter(n => (n.asn_isp || '').toLowerCase().includes(filters.value.isp.toLowerCase().trim()));
            if (filters.value.minQuality) {
                const minQ = parseFloat(filters.value.minQuality);
                if (!isNaN(minQ)) result = result.filter(n => parseFloat(n.q_score) >= minQ);
            }
            return result.sort((a, b) => sortDesc.value ? b.q_score - a.q_score : a.q_score - b.q_score);
        });

        // ==========================================
        // 🔍 BÚSQUEDA Y ORDENACIÓN (Cuentas)
        // ==========================================
        const accountSearch = ref('');
        const accountSort = ref({ field: null, desc: false });

        const toggleAccountSort = (field) => {
            if (accountSort.value.field === field) accountSort.value.desc = !accountSort.value.desc;
            else { accountSort.value.field = field; accountSort.value.desc = false; }
        };

        const displayedAccounts = computed(() => {
            let baseList = accountSearch.value ? accounts.value : currentTandaAccounts.value;

            if (accountSearch.value) {
                const s = accountSearch.value.toLowerCase().trim();
                baseList = baseList.filter(a => 
                    a.name.toLowerCase().includes(s) || 
                    (a.nodeId || '').toLowerCase().includes(s) || 
                    (a.ip || '').toLowerCase().includes(s) ||
                    (a.asn_isp || '').toLowerCase().includes(s)
                );
            }

            if (accountSort.value.field) {
                baseList = [...baseList].sort((a, b) => {
                    let valA = a[accountSort.value.field] || '';
                    let valB = b[accountSort.value.field] || '';
                    if (accountSort.value.field === 'q_score') { valA = parseFloat(valA) || 0; valB = parseFloat(valB) || 0; }
                    if (valA < valB) return accountSort.value.desc ? 1 : -1;
                    if (valA > valB) return accountSort.value.desc ? -1 : 1;
                    return 0;
                });
            }
            return baseList;
        });

        // ==========================================
        // 💾 PERSISTENCIA
        // ==========================================
        const saveData = () => {
            localStorage.setItem('vpnerp_acc_master_final', JSON.stringify(accounts.value));
            localStorage.setItem('vpnerp_pool_master_final', JSON.stringify(pool.value));
            localStorage.setItem('vpnerp_blk_master_final', JSON.stringify(blacklist.value));
            localStorage.setItem('vpnerp_last_isp_final', lastWorkedIsp.value);
        };

        const loadData = () => {
            let savedAcc = JSON.parse(localStorage.getItem('vpnerp_acc_master_final'));
            let savedPool = JSON.parse(localStorage.getItem('vpnerp_pool_master_final'));
            let savedBlk = JSON.parse(localStorage.getItem('vpnerp_blk_master_final'));
            let savedLastIsp = localStorage.getItem('vpnerp_last_isp_final') || '';

            if (!savedAcc || savedAcc.length === 0) {
                const oldKeys = ['v13', 'v12', 'v11', 'v10', 'v9', 'master', 'v8'];
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
                accounts.value = savedAcc.map(a => ({ ...a, uid: a.uid || generateUid(), previousIp: a.previousIp || null, worked: a.worked || false }));
            } else {
                const initial = [];
                for(let i = 1; i <= 28; i++) initial.push({ uid: generateUid(), name: `LON-${i < 10 ? '0'+i : i}`, nodeId: '', ip: '', q_score: '', asn_isp: '', previousIp: null, worked: false });
                accounts.value = initial;
            }
            pool.value = savedPool || [];
            blacklist.value = savedBlk || [];
            lastWorkedIsp.value = savedLastIsp;
        };

        watch([accounts, pool, blacklist, lastWorkedIsp], saveData, { deep: true });

        // ==========================================
        // ⚡ AUTO IP INFO (TOKEN PRIVADO)
        // ==========================================
        const fetchCurrentIP = async (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(!acc) return;

            syncStatus.value = 'Detectando IP...';
            let newIp = null;

            // Motor principal: ipinfo (Tu Token)
            try {
                const r1 = await fetch("https://ipinfo.io/json", { headers: { 'Authorization': 'Bearer 8c97cc52a98a48' } });
                if(r1.ok) { const d1 = await r1.json(); newIp = d1.ip; }
            } catch(e) {}

            // Respaldo
            if(!newIp) {
                try {
                    const r2 = await fetch("https://api.ipify.org?format=json");
                    if(r2.ok) { const d2 = await r2.json(); newIp = d2.ip; }
                } catch(e) {}
            }

            if(newIp) {
                if(acc.ip === newIp) { syncStatus.value = 'Misma IP.'; setTimeout(() => { syncStatus.value = ''; }, 3000); return; }
                const collides = accounts.value.some(a => a.uid !== uid && a.ip === newIp);
                if(collides) {
                    if(!confirm(`⚠️ ALERTA DE COLISIÓN\n\nLa IP detectada (${newIp}) YA ESTÁ en otra cuenta.\n¿Sobrescribir de todos modos?`)) { 
                        syncStatus.value = 'Cancelado.'; setTimeout(() => { syncStatus.value = ''; }, 3000); return; 
                    }
                }
                acc.previousIp = acc.ip; acc.ip = newIp; triggerCollisionCheck(acc); syncStatus.value = '¡IP extraída!';
            } else {
                showStatus('Fallo de Red en Navegador.');
            }
            setTimeout(() => { syncStatus.value = ''; }, 3000);
        };

        const undoIp = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc && acc.previousIp) {
                acc.ip = acc.previousIp; acc.previousIp = null; 
                triggerCollisionCheck(acc); syncStatus.value = 'IP Restaurada.'; setTimeout(() => { syncStatus.value = ''; }, 3000);
            }
        };

        // ==========================================
        // 🚀 API DE MYSTERIUM (PURA Y DIRECTA)
        // ==========================================
        const processNodeData = (data) => {
            const rawPool = [];
            const seenIds = new Set(); 
            data.forEach(nodo => {
                if (nodo.service_type !== "wireguard" || !nodo.provider_id) return;
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
            showStatus(`Pool Actualizado: ${pool.value.length} nodos guardados`);
        };

        const fetchAPI = async () => {
            syncStatus.value = 'Conectando a Mysterium...';
            try {
                // AQUÍ ESTÁ EL CÓDIGO ORIGINAL QUE NUNCA DEBIÓ CAMBIARSE
                const url = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
                const response = await fetch(url, { headers: { 'accept': 'application/json' } });
                
                if(!response.ok) throw new Error("HTTP " + response.status);
                
                const data = await response.json();
                processNodeData(data);
            } catch (err) {
                console.error(err);
                alert("⚠️ Mysterium bloqueó la conexión (CORS) o falló la red.\n\nSOLUCIÓN RÁPIDA: Ejecuta el curl en la terminal y sube el archivo usando 'Importar JSON'.");
                syncStatus.value = 'Error de API';
            }
        };

        const importPoolJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try { processNodeData(JSON.parse(e.target.result)); event.target.value = null; } 
                catch (err) { alert("Error JSON."); event.target.value = null; }
            };
            reader.readAsText(file);
        };

        // ==========================================
        // 🔧 MODALES Y LÓGICA DE TABLA
        // ==========================================
        const openPoolModal = (uid) => { selectedAccountUid.value = uid; clearFilters(); showPoolModal.value = true; };
        const closePoolModal = () => { showPoolModal.value = false; selectedAccountUid.value = null; };
        const openAccountSelectModal = (node) => { nodeToAssign.value = node; showAccountSelectModal.value = true; };
        const closeAccountSelectModal = () => { showAccountSelectModal.value = false; nodeToAssign.value = null; };
        
        const triggerCollisionCheck = (currentAccount) => {
            if(hasCollision(currentAccount)) alert(`¡ALERTA CRÍTICA!\n\nEl Nodo o IP ingresado YA EXISTE en otra cuenta activa.`);
        };

        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            return accounts.value.some(acc => {
                if (acc.uid === currentAccount.uid) return false;
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();
                return (accIp !== '' && curIp !== '' && accIp === curIp) || (accNode !== '' && curNode !== '' && accNode === curNode);
            });
        };

        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        const assignNodeToAccount = (nodeId) => {
            if (selectedAccountUid.value) {
                const acc = accounts.value.find(a => a.uid === selectedAccountUid.value);
                if (acc) {
                    const nodeData = pool.value.find(n => n.id === nodeId);
                    acc.nodeId = nodeId; acc.ip = ''; acc.previousIp = null; acc.worked = false;
                    if(nodeData) { acc.q_score = nodeData.q_score; acc.asn_isp = nodeData.asn_isp; }
                    closePoolModal(); triggerCollisionCheck(acc);
                }
            }
        };

        const confirmAssignFromPool = (accountUid) => {
            const acc = accounts.value.find(a => a.uid === accountUid);
            if (acc && nodeToAssign.value) {
                acc.nodeId = nodeToAssign.value.id; acc.ip = ''; acc.previousIp = null; acc.worked = false;
                acc.q_score = nodeToAssign.value.q_score; acc.asn_isp = nodeToAssign.value.asn_isp;
                closeAccountSelectModal(); triggerCollisionCheck(acc); showStatus(`Asignado a ${acc.name}`);
            }
        };

        const burnDirectlyFromPool = (node) => {
            if(node && node.id) {
                if(!blacklist.value.some(b => b.nodeId === node.id)) blacklist.value.unshift({ nodeId: node.id, ip: 'Quemado desde Pool' });
            }
        };

        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '', q_score: '', asn_isp: '', previousIp: null, worked: false });
        };
        const removeAccount = (uid) => { if(confirm("¿Eliminar cuenta?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };
        const releaseNode = (uid) => { const acc = accounts.value.find(a => a.uid === uid); if(acc) { acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.previousIp = null; acc.worked = false;} };
        
        const burnNode = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc) {
                const nodeStr = (acc.nodeId || '').trim();
                if(nodeStr) {
                    const truncado = nodeStr.substring(0, 14); 
                    if(!blacklist.value.some(b => b.nodeId === truncado)) blacklist.value.unshift({ nodeId: truncado, ip: acc.ip || 'Desconocida' });
                }
                acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.previousIp = null; acc.worked = false;
            }
        };

        const processBulkBlacklist = () => {
            if(!bulkBlacklistText.value.trim()) return;
            const rawItems = bulkBlacklistText.value.split(/[\n,\s]+/);
            rawItems.forEach(item => {
                const limpio = item.trim();
                if(limpio.length >= 10) { 
                    const truncado = limpio.substring(0, 14); 
                    if(!blacklist.value.some(b => b.nodeId === truncado)) blacklist.value.unshift({ nodeId: truncado, ip: 'Carga Masiva' });
                }
            });
            bulkBlacklistText.value = ''; 
        };
        const removeBlacklistNode = (index) => { blacklist.value.splice(index, 1); };

        const restoreBackup = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if(data.accounts) accounts.value = data.accounts;
                    if(data.pool) pool.value = data.pool;
                    if(data.blacklist) blacklist.value = data.blacklist;
                    showStatus('¡Base Restaurada!'); event.target.value = null;
                } catch (err) { alert("Archivo inválido."); event.target.value = null; }
            };
            reader.readAsText(file);
        };

        const copyToClipboard = async (text, type = 'Dato') => {
            try { await navigator.clipboard.writeText(text); showStatus(`¡${type} Copiado!`); setTimeout(() => { syncStatus.value = ''; }, 3000); } catch (err) {}
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ accounts: accounts.value, pool: pool.value, blacklist: blacklist.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url;
            a.download = `VPN_ERP_Respaldo_${new Date().toISOString().slice(0,10)}.json`; a.click();
        };

        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 3000); };
        
        onMounted(() => { loadData(); });

        // TODAS LAS VARIABLES EXPORTADAS CORRECTAMENTE
        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            showPoolModal, selectedAccountUid, showAccountSelectModal, nodeToAssign,
            collisionCount, accountSearch, accountSort, processedAccounts, toggleAccountSort, 
            filters, filteredPool, toggleSortScore, clearFilters, hasCollision, triggerCollisionCheck, 
            addAccount, removeAccount, releaseNode, burnNode, processBulkBlacklist, removeBlacklistNode, 
            importPoolJSON, fetchAPI, copyToClipboard, exportDatabase, restoreBackup,
            openPoolModal, closePoolModal, assignNodeToAccount,
            openAccountSelectModal, closeAccountSelectModal, confirmAssignFromPool, burnDirectlyFromPool,
            fetchCurrentIP, undoIp, lastWorkedIsp, getIspNameUI,
            currentTandaIndex, totalTandas, nextTanda, prevTanda, currentTandaAccounts, 
            currentTandaWorked, tandaProgress, displayedAccounts,
            isIspSafe, markAsWorked, unmarkWorked, resetAllWorked
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
